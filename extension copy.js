'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import ByteArray from 'gi://GLib';
import Main from 'resource:///org/gnome/shell/ui/main.js';
import PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class LastCallExtension extends Extension {
  constructor(metadata) {
    super(metadata);
    this._indicator = null;
  }

  enable() {
    this._indicator = new PrayerTimesIndicator(this);
    Main.panel.addToStatusArea('prayer-times-indicator', this._indicator);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}

class PrayerTimesIndicator extends PanelMenu.Button {
  constructor(extension) {
    super(0.0, _('Prayer Times'));
    this._extension = extension;
    this.metadata = extension.metadata;

    this.icon = new St.Icon({
      gicon: Gio.icon_new_for_string(`${this.metadata.path}/icons/icon.svg`),
      style_class: 'system-status-icon',
    });
    this.add_child(this.icon);

    this.label = new St.Label({
      text: '',
      y_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this.label);

    this.settings = this._extension.getSettings('org.gnome.shell.extensions.last-call');

    this._loadCities(() => {
      this._updatePrayerTimes();

      this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
        this._updatePrayerTimes();
        return GLib.SOURCE_CONTINUE;
      });
    });
  }

  _loadCities(callback) {
    let citiesFile = Gio.File.new_for_path(`${this.metadata.path}/cities.json`);
    citiesFile.load_contents_async(null, (file, res) => {
      try {
        // UTF-8 olarak string'e çevir
        const decoder = new TextDecoder('utf-8');
        const contentsString = decoder.decode(contents);
        let [success, contents] = citiesFile.load_contents_finish(res);
        this.cities = JSON.parse(ByteArray.toString(contents)).cities;
        if (callback) callback();
      } catch (e) {
        logError(e);
      }
    });
  }

  _updatePrayerTimes() {
    let selectedCityName = this.settings.get_string('selected-city');
    let city = this.cities.find((c) => c.name === selectedCityName);
    if (!city) return;

    let session = new Soup.Session();
    let message = Soup.Message.new('GET', city.url);

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
      try {
        let bytes = session.send_and_read_finish(result);
        let html = ByteArray.toString(bytes.get_data());
        this._parsePrayerTimes(html);
      } catch (e) {
        logError(e);
      }
    });
  }

  _parsePrayerTimes(html) {
    // Namaz vakitlerini çıkarmak için düzenli ifade
    //let     regex = /<div class="tpt-cell" data-vakit-name="(imsak|gunes|ogle|ikindi|aksam|yatsi)">.*?<div class="tpt-time">(\d{2}:\d{2})<\/div>/g;
    //const regex = /<div class="tpt-cell" data-vakit-name="(?:imsak|gunes|ogle|ikindi|aksam|yatsi)">.*?<div class="tpt-time">(\d{2}:\d{2})<\/div>/g;
    let regex = /<div\s+class="tpt-cell"\s+data-vakit-name="(imsak|gunes|ogle|ikindi|aksam|yatsi)".*?<div\s+class="tpt-time">(\d{2}:\d{2})<\/div>/gs;
    //let regex = /<div\s+class="tpt-cell"\s+data-vakit-name="(imsak|gunes|ogle|ikindi|aksam|yatsi)".*?<div\s+class="tpt-time">(\d{2}:\d{2})<\/div>/gs;
    //let regex = /<div\s+class="tpt-cell"\s+data-vakit-name="(imsak|gunes|ogle|ikindi|aksam|yatsi)".*?<div\s+class="tpt-time">(\d{2}:\d{2})<\/div>/gs;
    let matches = [...html.matchAll(regex)];

    if (matches.length !== 6) return;

    let times = {};
    for (let match of matches) {
      times[match[1]] = this._parseTime(match[2]);
    }

    let now = new Date();

    let prayerIntervals = [
      { name: _('İmsak'), start: times['imsak'], end: times['gunes'] },
      { name: _('Kuşluk'), start: times['gunes'], end: times['ogle'] },
      { name: _('Öğle'), start: times['ogle'], end: times['ikindi'] },
      { name: _('İkindi'), start: times['ikindi'], end: times['aksam'] },
      { name: _('Akşam'), start: times['aksam'], end: times['yatsi'] },
      { name: _('Yatsı'), start: times['yatsi'], end: this._addDays(times['imsak'], 1) },
    ];

    let nextPrayer;
    for (let interval of prayerIntervals) {
      if (now >= interval.start && now < interval.end) {
        nextPrayer = interval;
        break;
      }
    }

    if (!nextPrayer) {
      nextPrayer = prayerIntervals[0]; // Ertesi günün İmsak vakti
    }

    let timeLeft = Math.floor((nextPrayer.end - now) / 60000); // Dakika cinsinden
    this.label.set_text(`${nextPrayer.name}: ${timeLeft} dk`);

    if (timeLeft >= 15 && timeLeft <= 20 && !this._notified) {
      this._notify();
    }
  }

  _parseTime(timeString) {
    let [hours, minutes] = timeString.split(':').map(Number);
    let date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  _addDays(date, days) {
    let newDate = new Date(date);
    newDate.setDate(newDate.getDate() + days);
    return newDate;
  }

  _notify() {
    // Yanıp sönen ikon ve ses çalma
    this._notified = true;

    // İkonun yanıp sönmesi
    this._blinkIcon();

    // Ses çalma
    this._playSound();

    // Bildirim bayrağını namaz vakti geçtikten sonra sıfırla
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, (this._notificationDuration() * 60), () => {
      this._notified = false;
      if (this._blinkTimeout) {
        GLib.source_remove(this._blinkTimeout);
        this.icon.visible = true;
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  _blinkIcon() {
    let visible = true;
    this._blinkTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
      visible = !visible;
      this.icon.visible = visible;
      return GLib.SOURCE_CONTINUE;
    });
  }

  _playSound() {
    let soundFile = `${this.metadata.path}/sounds/call.wav`;
    try {
      GLib.spawn_command_line_async(`paplay "${soundFile}"`);
    } catch (e) {
      logError(e);
    }
  }

  _notificationDuration() {
    // Bildirimin aktif kalacağı süre (dakika cinsinden)
    return 5;
  }

  destroy() {
    if (this._timer) {
      GLib.source_remove(this._timer);
    }
    if (this._blinkTimeout) {
      GLib.source_remove(this._blinkTimeout);
    }
    super.destroy();
  }
}
