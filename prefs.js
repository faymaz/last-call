// prefs.js
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

const PrayerTimesPrefs = GObject.registerClass({
    GTypeName: 'PrayerTimesPrefs',
}, class PrayerTimesPrefs extends Adw.PreferencesWindow {
    _init(params = {}) {
        super._init(params);

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Prayer Times Settings',
            description: 'Configure notification settings'
        });

        // Add some basic settings
        const notificationSwitch = new Adw.ActionRow({
            title: 'Enable Notifications',
            subtitle: 'Show notifications before prayer times'
        });

        const soundSwitch = new Adw.ActionRow({
            title: 'Enable Sound',
            subtitle: 'Play sound with notifications'
        });

        group.add(notificationSwitch);
        group.add(soundSwitch);
        page.add(group);
        this.add(page);
    }
});

export default class Prefs extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    fillPreferencesWindow(window) {
        window.add(new Adw.PreferencesPage());
    }
}