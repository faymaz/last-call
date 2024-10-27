'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=2.4';
import Main from 'resource:///org/gnome/shell/ui/main.js';
import PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class LastCallExtension extends Extension {
  enable() {
    log('LastCallExtension enabled');
    this._indicator = new PrayerTimesIndicator(this);
    Main.panel.addToStatusArea('prayer-times-indicator', this._indicator);
  }

  disable() {
    log('LastCallExtension disabled');
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}

const PrayerTimesIndicator = GObject.registerClass(
  class PrayerTimesIndicator extends PanelMenu.Button {
    _init(extension) {
      log('PrayerTimesIndicator constructor called');
      try {
        super._init(0.0, _('Prayer Times'), false);
        this._extension = extension;

        this.icon = new St.Icon({
          icon_name: 'system-run', // Geçici olarak varsayılan bir ikon kullanıyoruz
          style_class: 'system-status-icon',
        });
        this.add_child(this.icon);
        log('Icon added to panel');

        this.label = new St.Label({
          text: '',
          y_expand: true,
          y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this.label);
        log('Label added to panel');

        this.settings = this._extension.getSettings('org.gnome.shell.extensions.last-call');
        log('Settings obtained');

        // Şehir verilerini doğrudan burada tanımlıyoruz
        this.cities = [
          { name: 'Mörfelden-Walldorf', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/10214/morfelden---walldorf-icin-namaz-vakti' },
          { name: 'Tuttlingen', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/11083/tuttlingen-icin-namaz-vakti' },
          { name: 'Costa Mesa', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8608/costa-mesa-icin-namaz-vakti' },
          { name: 'Irvine', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8622/irvine-icin-namaz-vakti' },
          { name: 'Clifton', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8869/clifton-icin-namaz-vakti' },
        ];
        log('Cities defined');

        // Ayar değişikliklerini dinliyoruz
        this._settingsChangedId = this.settings.connect('changed::selected-city', () => {
          log('Şehir değiştirildi, yeni şehir: ' + this.settings.get_string('selected-city'));
          this._updatePrayerTimes();
        });
        log('Settings changed signal connected');

        // İlk güncelleme
        this._updatePrayerTimes();
        log('Initial prayer times update triggered');

        // Her 5 dakikada bir güncelle
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
          this._updatePrayerTimes();
          return GLib.SOURCE_CONTINUE;
        });
        log('Timer set for prayer times updates');
      } catch (e) {
        logError(e);
      }
    }

    _updatePrayerTimes() {
      try {
        let selectedCityName = this.settings.get_string('selected-city');
        let city = this.cities.find((c) => c.name === selectedCityName);
        log('Namaz vakitleri güncelleniyor...');
        if (!city) {
          city = this.cities[0];
          this.settings.set_string('selected-city', city.name);
          log('Varsayılan şehre dönüldü: ' + city.name);
        }

        let session = new Soup.Session();
        let message = new Soup.Message('GET', city.url);
        log('HTTP GET isteği gönderiliyor: ' + city.url);

        session.queue_message(message, (session, message) => {
          try {
            if (message.status_code !== Soup.Status.OK) {
              throw new Error(`HTTP isteği başarısız oldu: ${message.status_code}`);
            }
            let body = message.response_body.data;
            let decoder = new TextDecoder('utf-8');
            let html = decoder.decode(body);
            log('HTML içeriği alındı, namaz vakitleri parse ediliyor');
            this._parsePrayerTimes(html);
          } catch (e) {
            logError(e);
          }
        });
      } catch (e) {
        logError(e);
      }
    }

    _parsePrayerTimes(html) {
      log('Namaz vakitleri parse edilmeye başlandı');
      try {
        // Namaz vakitlerini çıkarmak için düzenli ifade
        let regex = /<div\s+class="tpt-cell"\s+data-vakit-name="(imsak|gunes|ogle|ikindi|aksam|yatsi)".*?<div\s+class="tpt-time">(\d{2}:\d{2})<\/div>/gs;
        let matches = [...html.matchAll(regex)];
        log('Bulunan namaz vakitleri sayısı: ' + matches.length);

        if (matches.length < 6) {
          log('Tüm namaz vakitleri bulunamadı. Elde edilen matches.length: ' + matches.length);
          return;
        }

        let times = {};
        for (let match of matches) {
          let vakitName = match[1];
          let timeString = match[2];
          times[vakitName] = this._parseTime(timeString);
          log(`Parsed ${vakitName}: ${times[vakitName]}`);
        }

        let now = new Date();
        log('Şu anki zaman: ' + now.toLocaleTimeString());

        // Namaz vakitlerini kontrol edip sonraki vakti bulalım
        let vakitler = ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];
        let nextPrayer = null;

        for (let i = 0; i < vakitler.length; i++) {
          let vakit = vakitler[i];
          if (now < times[vakit]) {
            nextPrayer = { name: vakit, time: times[vakit] };
            log(`Sonraki namaz vakti: ${nextPrayer.name} at ${nextPrayer.time.toLocaleTimeString()}`);
            break;
          }
        }

        if (!nextPrayer) {
          // Ertesi günün imsak vaktini alalım
          nextPrayer = { name: 'imsak', time: this._addDays(times['imsak'], 1) };
          log(`Sonraki namaz vakti: ${nextPrayer.name} at ${nextPrayer.time.toLocaleTimeString()}`);
        }

        let timeLeft = Math.floor((nextPrayer.time - now) / 60000); // Dakika cinsinden
        log(`Sonraki namaz vakitine kalan süre: ${timeLeft} dakika`);

        this.label.set_text(`${nextPrayer.name}: ${timeLeft} dk`);
      } catch (e) {
        logError(e);
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

    destroy() {
      log('PrayerTimesIndicator destroyed');
      if (this._timer) {
        GLib.source_remove(this._timer);
        this._timer = null;
      }
      if (this._settingsChangedId) {
        this.settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      super.destroy();
    }
  }
);
