'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import Main from 'resource:///org/gnome/shell/ui/main.js';
import PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class LastCallExtension extends Extension {
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
    super(0.0, _('Prayer Times'), false);
    this._extension = extension;

    // this.icon = new St.Icon({
    //   gicon: Gio.icon_new_for_string(`${extension.path}/icons/icon.svg`),
    //   style_class: 'system-status-icon',
    // });
    this.icon = new St.Icon({
      icon_name: 'system-run',
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

    // Şehir verilerini doğrudan burada tanımlıyoruz
    this.cities = [
      { name: 'Mörfelden-Walldorf', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/10214/morfelden---walldorf-icin-namaz-vakti' },
      { name: 'Tuttlingen', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/11083/tuttlingen-icin-namaz-vakti' },
      { name: 'Costa Mesa', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8608/costa-mesa-icin-namaz-vakti' },
      { name: 'Irvine', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8622/irvine-icin-namaz-vakti' },
      { name: 'Clifton', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8869/clifton-icin-namaz-vakti' },
    ];

    // Ayar değişikliklerini dinliyoruz
    this._settingsChangedId = this.settings.connect('changed::selected-city', () => {
      this._updatePrayerTimes();
    });

    // İlk güncelleme
    this._updatePrayerTimes();

    // Her 5 dakikada bir güncelle
    this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
      this._updatePrayerTimes();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _updatePrayerTimes() {
    let selectedCityName = this.settings.get_string('selected-city');
    let city = this.cities.find((c) => c.name === selectedCityName);
    if (!city) {
      // Eğer şehir bulunamazsa varsayılan olarak ilk şehri kullan
      city = this.cities[0];
      this.settings.set_string('selected-city', city.name);
    }

    let session = new Soup.Session();
    let message = new Soup.Message('GET', city.url);

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
      try {
        let bytes = session.send_and_read_finish(result);
        if (message.status_code !== Soup.Status.OK) {
          throw new Error(`HTTP isteği başarısız oldu: ${message.status_code}`);
        }
        let decoder = new TextDecoder('utf-8');
        let html = decoder.decode(bytes.get_data());
        this._parsePrayerTimes(html);
      } catch (e) {
        logError(e);
      }
    });
  }

  // Diğer metotlar aynı kalabilir
}