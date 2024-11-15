// extension.js
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

function loadCitiesData(extensionPath) {
    try {
        let citiesPath = GLib.build_filenamev([extensionPath, 'cities.json']);
        let [success, contents] = GLib.file_get_contents(citiesPath);
        
        if (!success) {
            log('[PrayerTimes] Failed to read cities.json');
            return null;
        }

        let citiesJson = new TextDecoder().decode(contents);
        let data = JSON.parse(citiesJson);
        log(`[PrayerTimes] Loaded ${data.cities.length} cities`);
        return data;
    } catch (error) {
        log(`[PrayerTimes] Error loading cities: ${error}`);
        return null;
    }
}

function calculateTimeDifference(currentTime, targetTime, isNextDay = false) {
    let [targetHour, targetMinute] = targetTime.split(':').map(Number);
    let currentHour = currentTime.get_hour();
    let currentMinute = currentTime.get_minute();

    // Calculate total minutes
    let targetMinutes = targetHour * 60 + targetMinute;
    let currentMinutes = currentHour * 60 + currentMinute;

    if (isNextDay) {
        targetMinutes += 24 * 60; // Add 24 hours worth of minutes
    }

    let diffMinutes = targetMinutes - currentMinutes;
    return {
        hours: Math.floor(diffMinutes / 60),
        minutes: diffMinutes % 60
    };
}

const PRAYER_NAMES = {
    'en': {
        'imsak': 'Fajr',
        'gunes': 'Sun',
        'ogle': 'Dhuhr',
        'ikindi': 'Asr',
        'aksam': 'Maghrib',
        'yatsi': 'Isha'
    },
    'tr': {
        'imsak': 'İmsak',
        'gunes': 'Güneş',
        'ogle': 'Öğle',
        'ikindi': 'İkindi',
        'aksam': 'Akşam',
        'yatsi': 'Yatsı'
    },
    'de': {
        'imsak': 'Fadschr',
        'gunes': 'Sonne',
        'ogle': 'Dhur',
        'ikindi': 'Asr',
        'aksam': 'Maghrib',
        'yatsi': 'Ischa'
    }
};

const PrayerTimesIndicator = GObject.registerClass(
class PrayerTimesIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Prayer Times Indicator');

        this._extension = extension;
        this._timeoutSource = null;
        this._prayerTimes = {};
        this._currentLanguage = 'en';
        this._citiesData = loadCitiesData(this._extension.path);
        this._selectedCity = this._citiesData?.cities[0]?.name || "İstanbul";
        this._lastNotificationTime = null;
        
        this._httpSession = new Soup.Session({
            timeout: 60,
            user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        });

        // Create icon
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', 'icon.svg'])),
            style_class: 'system-status-icon'
        });

        // Create label
        this._label = new St.Label({
            text: 'Loading...',
            y_expand: true,
            y_align: 2
        });

        // Add to panel
        let hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        hbox.add_child(this._icon);
        hbox.add_child(this._label);
        this.add_child(hbox);

        // Create menu
        this._buildMenu();
        
        // Start fetching times
        this._startUpdating();
    }
    _buildMenu() {
        if (!this._citiesData) {
            log('[PrayerTimes] No cities data available');
            return;
        }

        // City selector
        let cityItem = new PopupMenu.PopupSubMenuMenuItem('Select City');
        this._citiesData.cities.forEach(city => {
            let item = new PopupMenu.PopupMenuItem(city.name);
            item.connect('activate', () => {
                log(`[PrayerTimes] Selected city: ${city.name}`);
                this._selectedCity = city.name;
                this._label.text = 'Loading...';
                this._fetchPrayerTimes();
            });
            cityItem.menu.addMenuItem(item);
        });

        this.menu.addMenuItem(cityItem);

        // Language selector
        let langItem = new PopupMenu.PopupSubMenuMenuItem('Language');
        ['en', 'tr', 'de'].forEach(lang => {
            let item = new PopupMenu.PopupMenuItem(lang.toUpperCase());
            item.connect('activate', () => {
                log(`[PrayerTimes] Selected language: ${lang}`);
                this._currentLanguage = lang;
                this._updateDisplay();
            });
            langItem.menu.addMenuItem(item);
        });

        this.menu.addMenuItem(langItem);
    }

    async _fetchPrayerTimes() {
        if (!this._citiesData) {
            log('[PrayerTimes] No cities data available');
            return;
        }

        let cityData = this._citiesData.cities.find(city => city.name === this._selectedCity);
        if (!cityData) {
            log(`[PrayerTimes] City not found: ${this._selectedCity}`);
            return;
        }
        
        try {
            log(`[PrayerTimes] Fetching from URL: ${cityData.url}`);
            
            let message = new Soup.Message({
                method: 'GET',
                uri: GLib.Uri.parse(cityData.url, GLib.UriFlags.NONE)
            });

            message.request_headers.append('Accept', 'text/html,application/xhtml+xml');
            message.request_headers.append('Accept-Language', 'tr-TR,tr');
            message.request_headers.append('Cache-Control', 'no-cache');

            let bytes = await this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.status_code !== 200) {
                throw new Error(`HTTP error: ${message.status_code}`);
            }

            let text = new TextDecoder().decode(bytes.get_data());
            log(`[PrayerTimes] Response received, length: ${text.length}`);

            const timeRegex = /<div class="tpt-cell" data-vakit-name="([^"]+)"[^>]*>[\s\S]*?<div class="tpt-time">(\d{2}:\d{2})<\/div>/g;
            let times = {};
            let match;

            while ((match = timeRegex.exec(text)) !== null) {
                const [_, name, time] = match;
                times[name] = time;
                log(`[PrayerTimes] Found time for ${name}: ${time}`);
            }

            if (Object.keys(times).length === 0) {
                throw new Error('No prayer times found in parsed HTML');
            }

            this._prayerTimes = times;
            this._updateDisplay();
        } catch (error) {
            log(`[PrayerTimes] Error: ${error.message}`);
            this._label.text = 'Error fetching times';
        }
    }

    _updateDisplay() {
        let nextPrayer = this._findNextPrayer();
        if (nextPrayer) {
            let timeInfo = this._calculateTimeLeft(nextPrayer.time, nextPrayer.isNextDay);
            let prayerName = PRAYER_NAMES[this._currentLanguage][nextPrayer.name];
            this._label.text = `${prayerName}: ${timeInfo.formatted}`;
            
            if (timeInfo.totalMinutes >= 15 && timeInfo.totalMinutes <= 20) {
                this._showNotification(prayerName, timeInfo.totalMinutes);
            }
        }
    }

    _findNextPrayer() {
        if (!this._prayerTimes || Object.keys(this._prayerTimes).length === 0) {
            return null;
        }

        let currentTime = GLib.DateTime.new_now_local();
        let currentTimeString = currentTime.format('%H:%M');
        log(`[PrayerTimes] Current time: ${currentTimeString}`);

        let prayers = Object.entries(this._prayerTimes);
        
        // First check remaining prayers for today
        for (let [name, time] of prayers) {
            if (time > currentTimeString) {
                log(`[PrayerTimes] Next prayer today: ${name} at ${time}`);
                return {name, time, isNextDay: false};
            }
        }

        // If no prayer is left today, take the first prayer of tomorrow
        log(`[PrayerTimes] No prayer left today, next prayer is tomorrow: ${prayers[0][0]} at ${prayers[0][1]}`);
        return {name: prayers[0][0], time: prayers[0][1], isNextDay: true};
    }

    _calculateTimeLeft(prayerTime, isNextDay = false) {
        let currentTime = GLib.DateTime.new_now_local();
        let diff = calculateTimeDifference(currentTime, prayerTime, isNextDay);
        
        log(`[PrayerTimes] Time calculation for ${prayerTime} - Hours: ${diff.hours}, Minutes: ${diff.minutes}`);
        
        return {
            hours: diff.hours,
            minutes: diff.minutes,
            totalMinutes: diff.hours * 60 + diff.minutes,
            formatted: `${diff.hours}h ${diff.minutes}m`
        };
    }

    _showNotification(prayerName, minutesLeft) {
        let currentTime = GLib.DateTime.new_now_local();
        if (this._lastNotificationTime && 
            (currentTime.difference(this._lastNotificationTime) / 1000 / 60) < 180) {
            log('[PrayerTimes] Skipping notification - cooldown period active');
            return;
        }

        this._lastNotificationTime = currentTime;
        log(`[PrayerTimes] Showing notification for ${prayerName} (${minutesLeft} minutes left)`);

        // Visual notification
        this._icon.style_class = 'system-status-icon blink';
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._icon.style_class = 'system-status-icon';
            log('[PrayerTimes] Stopped blinking icon');
            return GLib.SOURCE_REMOVE;
        });

        // Play sound
        try {
            const soundPath = GLib.build_filenamev([this._extension.path, 'sounds', 'call.mp3']);
            log(`[PrayerTimes] Attempting to play sound file: ${soundPath}`);
            
            const soundFile = Gio.File.new_for_path(soundPath);
            
            if (soundFile.query_exists(null)) {
                log('[PrayerTimes] Sound file exists, initializing GStreamer');
                
                imports.gi.Gst.init(null);
                let player = imports.gi.Gst.ElementFactory.make('playbin', 'player');
                
                if (player) {
                    const uri = soundFile.get_uri();
                    log(`[PrayerTimes] Playing sound from URI: ${uri}`);
                    player.set_property('uri', uri);
                    player.set_state(imports.gi.Gst.State.PLAYING);
                    
                    // Let the sound play completely
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                        log('[PrayerTimes] Stopping sound playback');
                        player.set_state(imports.gi.Gst.State.NULL);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        } catch (error) {
            log(`[PrayerTimes] Error playing sound: ${error}`);
        }
    }

    _startUpdating() {
        this._fetchPrayerTimes();
        
        if (this._timeoutSource) {
            GLib.source_remove(this._timeoutSource);
        }

        // Update every minute for more precise notifications
        this._timeoutSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._timeoutSource) {
            GLib.source_remove(this._timeoutSource);
        }
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        super.destroy();
    }
});

export default class PrayerTimesExtension extends Extension {
    enable() {
        log('[PrayerTimes] Enabling extension');
        this._indicator = new PrayerTimesIndicator(this);
        Main.panel.addToStatusArea('prayer-times', this._indicator);
    }

    disable() {
        log('[PrayerTimes] Disabling extension');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}