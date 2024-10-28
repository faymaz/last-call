'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
//import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
//import {PlacesManager} from './utils.js';

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
            super._init(0.0, 'Prayer Times', false);
            log('PrayerTimesIndicator constructor called');

            // İkon ekleme
            this.icon = new St.Icon({
                icon_name: 'system-run', // Geçici olarak varsayılan ikon
                style_class: 'system-status-icon',
            });
            this.add_child(this.icon);
            log('Icon added to panel');

            // Etiket ekleme
            this.label = new St.Label({
                text: '',
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this.label);
            log('Label added to panel');

            // Ayarları alma
            this.settings = extension.getSettings('org.gnome.shell.extensions.last-call');
            log('Settings obtained');

            // Şehir verilerini tanımlama
            this.cities = [
                { name: 'Mörfelden-Walldorf', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/10214/morfelden---walldorf-icin-namaz-vakti' },
                { name: 'Tuttlingen', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/11083/tuttlingen-icin-namaz-vakti' },
                { name: 'Costa Mesa', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8608/costa-mesa-icin-namaz-vakti' },
                { name: 'Irvine', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8622/irvine-icin-namaz-vakti' },
                { name: 'Clifton', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8869/clifton-icin-namaz-vakti' },
            ];
            log('Cities defined');

            // Ayar değişikliklerini dinleme
            this._settingsChangedId = this.settings.connect('changed::selected-city', () => {
                log('Şehir değiştirildi, yeni şehir: ' + this.settings.get_string('selected-city'));
                this._updatePrayerTimes();
            });
            log('Settings changed signal connected');

            // İlk güncelleme
            this._updatePrayerTimes();
            log('Initial prayer times update triggered');

            // Her 5 dakikada bir güncelleme
            this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
                this._updatePrayerTimes();
                return GLib.SOURCE_CONTINUE;
            });
            log('Timer set for prayer times updates');
        }

        async _updatePrayerTimes() {
            try {
                let selectedCityName = this.settings.get_string('selected-city');
                log(`Selected City Name: "${selectedCityName}"`);
                
                let city = this.cities.find(c => c.name === selectedCityName);
                log(`Found City: ${city ? city.name : 'None'}`);
                
                if (!city) {
                    if (this.cities.length === 0) {
                        logError('Cities array is empty.');
                        return;
                    }
                    city = this.cities[0];
                    this.settings.set_string('selected-city', city.name);
                    log(`Default city set to: ${city.name}`);
                }

                let session = new Soup.Session();
                let message = Soup.Message.new('GET', city.url);
                log(`Sending HTTP GET request to: ${city.url}`);

                session.send_and_read_async(message)
                    .then((bytes) => {
                        if (message.status_code !== Soup.Status.OK) {
                            throw new Error(`HTTP request failed with status: ${message.status_code}`);
                        }
                        let decoder = new TextDecoder('utf-8');
                        let html = decoder.decode(bytes.get_data());
                        log('HTML content received, parsing prayer times...');
                        this._parsePrayerTimes(html);
                    })
                    .catch((e) => {
                        logError(e);
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
                let matches = Array.from(html.matchAll(regex));
                log(`Bulunan namaz vakitleri sayısı: ${matches.length}`);

                if (matches.length < 6) {
                    log('Tüm namaz vakitleri bulunamadı.');
                    return;
                }

                let times = {};
                for (let match of matches) {
                    let vakitName = match[1];
                    let timeStr = match[2];
                    let [hours, minutes] = timeStr.split(':').map(Number);
                    let now = new Date();
                    let time = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
                    times[vakitName] = time;
                    log(`Parsed ${vakitName}: ${time.toLocaleTimeString()}`);
                }

                let now = new Date();
                let nextPrayer = null;
                const vakitler = ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];

                for (let vakit of vakitler) {
                    if (now < times[vakit]) {
                        nextPrayer = { name: vakit, time: times[vakit] };
                        log(`Sonraki namaz vakti: ${nextPrayer.name} at ${nextPrayer.time.toLocaleTimeString()}`);
                        break;
                    }
                }

                if (!nextPrayer) {
                    // Ertesi günün imsak vaktini alalım
                    let imsakTime = new Date(times['imsak']);
                    imsakTime.setDate(imsakTime.getDate() + 1);
                    nextPrayer = { name: 'imsak', time: imsakTime };
                    log(`Sonraki namaz vakti: ${nextPrayer.name} at ${nextPrayer.time.toLocaleTimeString()}`);
                }

                let timeLeft = Math.floor((nextPrayer.time - now) / 60000); // Dakika cinsinden
                log(`Sonraki namaz vakitine kalan süre: ${timeLeft} dakika`);
                this.label.set_text(`${nextPrayer.name}: ${timeLeft} dk`);
            } catch (e) {
                logError(e);
            }
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

var __gtype_name__ = 'PrayerTimesIndicator';

function init() {
}

function enable() {
    log('LastCallExtension enabled');
    indicator = new PrayerTimesIndicator(this);
    Main.panel.addToStatusArea('prayer-times-indicator', indicator);
}

function disable() {
    log('LastCallExtension disabled');
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
}
