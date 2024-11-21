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
        this._isDestroyed = false; //let _isDestroyed = false;
        this._activeTimers = new Set(); //let _activeTimers = new Set();
        this._extension = extension;
        this._timeoutSource = null;
        this._prayerTimes = {};
        this._currentLanguage = 'en';
        this._citiesData = loadCitiesData(this._extension.path);
        this._selectedCity = this._citiesData?.cities[0]?.name || "İstanbul";
        this._lastNotificationTime = null;
        this._isBlinking = false;
        this._isPlayingSound = false;
        this._player = null;
        this._retryCount = 0;
        this._maxRetries = 3;
        
        // Create session with retry mechanism
        this._initHttpSession();
        
        // Create icon with error handling
        try {
            this._icon = new St.Icon({
                gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', 'icon.svg'])),
                style_class: 'system-status-icon'
            });
        } catch (error) {
            log(`[PrayerTimes] Error loading icon: ${error}`);
            // Fallback to system icon
            this._icon = new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'system-status-icon'
            });
        }
    
        // Create label with error handling
        this._label = new St.Label({
            text: 'Loading...',
            y_expand: true,
            y_align: 2
        });
    
        // In the _init method, replace the loading indicator creation with:
        // Create loading indicator
        this._fetchingIndicator = new St.Label({
            text: '⟳',  // Unicode loading symbol
            y_expand: true,
            y_align: 2,
            style_class: 'loading-indicator',
            visible: false
        });
    
        // Add to panel with error handling
        try {
            let hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
            hbox.add_child(this._icon);
            hbox.add_child(this._label);
            hbox.add_child(this._fetchingIndicator);  // Add loading indicator to hbox
            this.add_child(hbox);
        } catch (error) {
            log(`[PrayerTimes] Error creating panel layout: ${error}`);
        }
    
        // Create menu
        this._buildMenu();
        
        // Start fetching times with retry mechanism
        this._startUpdating();
    }
    
    _clearTimers() {
        for (let timerId of this._activeTimers) {
            GLib.source_remove(timerId);
        }
        this._activeTimers.clear();
    }
    _initHttpSession() {
        try {
            this._httpSession = new Soup.Session({
                timeout: 60,
                user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            });
            this._retryCount = 0;
        } catch (error) {
            log(`[PrayerTimes] Error initializing HTTP session: ${error}`);
            if (this._retryCount < this._maxRetries) {
                this._retryCount++;
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                    this._initHttpSession();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _showLoading() {
        if (this._fetchingIndicator) {
            try {
                this._fetchingIndicator.visible = true;
                // Add rotation class if using icon approach
                if (this._fetchingIndicator instanceof St.Icon) {
                    this._fetchingIndicator.add_style_class_name('loading-indicator');
                }
            } catch (error) {
                log(`[PrayerTimes] Error showing loading indicator: ${error}`);
            }
        }
    }
    
    _hideLoading() {
        if (this._fetchingIndicator) {
            try {
                this._fetchingIndicator.visible = false;
                // Remove rotation class if using icon approach
                if (this._fetchingIndicator instanceof St.Icon) {
                    this._fetchingIndicator.remove_style_class_name('loading-indicator');
                }
            } catch (error) {
                log(`[PrayerTimes] Error hiding loading indicator: ${error}`);
            }
        }
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
        
        this._showLoading();  // Show loading indicator
        
        try {
            if (!this._httpSession) {
                log('[PrayerTimes] HTTP session not initialized, retrying...');
                this._initHttpSession();
                return;
            }
    
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
                throw new Error('No prayer times found in response');
            }
    
            this._prayerTimes = times;
            this._updateDisplay();
            this._hideLoading();  // Hide loading indicator on success
        } catch (error) {
            log(`[PrayerTimes] Error fetching prayer times: ${error}`);
            this._hideLoading();  // Hide loading indicator on error
            if (error.message.includes('not initialized') || error.message.includes('Xwayland')) {
                if (this._retryCount < this._maxRetries) {
                    this._retryCount++;
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                        this._fetchPrayerTimes();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
            this._label.text = 'Error fetching times';
        }
    }
    _updateDisplay() {
        if (this._isDestroyed) return;
        
        const nextPrayer = this._findNextPrayer();
        if (!nextPrayer) return;
    
        try {
            const timeInfo = this._calculateTimeLeft(nextPrayer.time, nextPrayer.isNextDay);
            const prayerName = PRAYER_NAMES[this._currentLanguage][nextPrayer.name];
            
            if (this._label && !this._label.is_finalized?.()) {
                this._label.text = `${prayerName}: ${timeInfo.formatted}`;
                
                if (timeInfo.totalMinutes >= 15 && timeInfo.totalMinutes <= 20) {
                    this._showNotification(prayerName, timeInfo.totalMinutes);
                }
            }
        } catch (error) {
            log(`[PrayerTimes] Display update error: ${error}`);
        }
    }

    // Add these methods to handle cleanup better
    _cleanupTimers() {
        if (this._timeoutSource) {
            GLib.source_remove(this._timeoutSource);
            this._timeoutSource = null;
        }
        
        if (this._activeTimers) {
            this._activeTimers.forEach(timerId => {
                try {
                    GLib.source_remove(timerId);
                } catch (error) {
                    log(`[PrayerTimes] Error removing timer ${timerId}: ${error}`);
                }
            });
            this._activeTimers.clear();
        }
    }

    _cleanupUI() {
        ['_label', '_icon', '_fetchingIndicator'].forEach(widgetName => {
            if (this[widgetName]) {
                try {
                    if (!this[widgetName].is_finalized?.()) {
                        this[widgetName].destroy();
                    }
                } catch (error) {
                    log(`[PrayerTimes] Error destroying ${widgetName}: ${error}`);
                }
                this[widgetName] = null;
            }
        });
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
        
        // Calculate total minutes for notification check
        let totalMinutes = diff.hours * 60 + diff.minutes;
        
        log(`[PrayerTimes] Time calculation for ${prayerTime} - Hours: ${diff.hours}, Minutes: ${diff.minutes}, Total: ${totalMinutes}`);
        
        return {
            hours: diff.hours,
            minutes: diff.minutes,
            totalMinutes: totalMinutes,
            formatted: `${diff.hours}h ${diff.minutes}m`
        };
    }

    _showNotification(prayerName, minutesLeft) {
        // Only show notification between 15-20 minutes
        if (minutesLeft < 15 || minutesLeft > 20) {
            return;
        }

        // Check if we've already shown a notification recently
        let currentTime = GLib.DateTime.new_now_local();
        if (this._lastNotificationTime) {
            let timeSinceLastNotification = Math.floor(
                currentTime.difference(this._lastNotificationTime) / 1000 / 60
            );
            
            // Only show notification once every 4 hours
            if (timeSinceLastNotification < 240) {
                log(`[PrayerTimes] Skipping notification - last one was ${timeSinceLastNotification} minutes ago`);
                return;
            }
        }

        this._lastNotificationTime = currentTime;
        log(`[PrayerTimes] Showing notification for ${prayerName} (${minutesLeft} minutes left)`);

        // Visual notification - blink for 1 minute
        if (!this._isBlinking) {
            this._isBlinking = true;
            this._icon.style_class = 'system-status-icon blink';
            
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                if (this._icon) {
                    this._icon.style_class = 'system-status-icon';
                    this._isBlinking = false;
                }
                log('[PrayerTimes] Stopped blinking icon');
                return GLib.SOURCE_REMOVE;
            });
        }

        // Play sound
        try {
            if (!this._isPlayingSound) {
                this._isPlayingSound = true;
                const soundPath = GLib.build_filenamev([this._extension.path, 'sounds', 'call.mp3']);
                log(`[PrayerTimes] Attempting to play sound file: ${soundPath}`);
                
                const soundFile = Gio.File.new_for_path(soundPath);
                
                if (soundFile.query_exists(null)) {
                    log('[PrayerTimes] Sound file exists, initializing GStreamer');
                    
                    imports.gi.Gst.init(null);
                    this._player = imports.gi.Gst.ElementFactory.make('playbin', 'player');
                    
                    if (this._player) {
                        const uri = soundFile.get_uri();
                        log(`[PrayerTimes] Playing sound from URI: ${uri}`);
                        this._player.set_property('uri', uri);
                        this._player.set_state(imports.gi.Gst.State.PLAYING);
                        
                        // Let the sound play completely
                        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                            if (this._player) {
                                log('[PrayerTimes] Stopping sound playback');
                                this._player.set_state(imports.gi.Gst.State.NULL);
                                this._player = null;
                            }
                            this._isPlayingSound = false;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            }
        } catch (error) {
            log(`[PrayerTimes] Error playing sound: ${error}`);
            this._isPlayingSound = false;
        }
    }
    _addTimer(callback, interval) {
        if (this._isDestroyed) {
            log('[PrayerTimes] Not adding timer - already destroyed');
            return null;
        }
    
        try {
            const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
                if (this._isDestroyed) {
                    log('[PrayerTimes] Timer cancelled - extension destroyed');
                    return GLib.SOURCE_REMOVE;
                }
                return callback();
            });
            this._activeTimers.add(timerId);
            return timerId;
        } catch (error) {
            log(`[PrayerTimes] Error adding timer: ${error}`);
            return null;
        }
    }
    _startUpdating() {
        if (this._isDestroyed) {
            log('[PrayerTimes] Not starting updates - already destroyed');
            return;
        }
        
        try {
            this._fetchPrayerTimes();
            this._cleanupTimers();
            this._addTimer(() => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            }, 60);
        } catch (error) {
            log(`[PrayerTimes] Error starting updates: ${error}`);
        }
    }
    destroy() {
        log('[PrayerTimes] Starting cleanup...');
        
        this._isDestroyed = true;
        
        try {
            // Stop all timers first
            this._cleanupTimers();
            
            // Cleanup HTTP session
            if (this._httpSession) {
                try {
                    this._httpSession.abort();
                } catch (error) {
                    log(`[PrayerTimes] Error aborting HTTP session: ${error}`);
                }
                this._httpSession = null;
            }

            // Cleanup UI elements
            this._cleanupUI();

            // Reset state
            this._prayerTimes = {};
            this._isPlayingSound = false;
            this._isBlinking = false;
            this._timeoutSource = null;
            
            log('[PrayerTimes] Cleanup complete');
        } catch (error) {
            log(`[PrayerTimes] Error during cleanup: ${error}`);
        } finally {
            super.destroy();
        }
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
            try {
                this._indicator.destroy();
            } catch (error) {
                log(`[PrayerTimes] Error destroying indicator: ${error}`);
            }
            this._indicator = null;
        }
    }
}