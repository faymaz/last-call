'use strict';

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import ByteArray from 'gi://GLib';

export default class LastCallPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings('org.gnome.shell.extensions.last-call');

    const page = new Adw.PreferencesPage();
    window.add(page);

    const group = new Adw.PreferencesGroup();
    page.add(group);

    const comboRow = new Adw.ComboRow({
      title: _('Select City:'),
    });

    const citiesFile = Gio.File.new_for_path(`${this.dir.get_path()}/cities.json`);
    citiesFile.load_contents_async(null, (file, res) => {
      try {
        let [success, contents] = citiesFile.load_contents_finish(res);
        let cities = JSON.parse(ByteArray.toString(contents)).cities;

        let stringList = new Gtk.StringList();
        for (let city of cities) {
          stringList.append(city.name);
        }
        comboRow.model = stringList;

        let activeIndex = cities.findIndex((c) => c.name === settings.get_string('selected-city'));
        comboRow.selected = activeIndex >= 0 ? activeIndex : 0;

        comboRow.connect('notify::selected', () => {
          let activeCity = comboRow.model.get_string(comboRow.selected);
          settings.set_string('selected-city', activeCity);
        });

        group.add(comboRow);
      } catch (e) {
        logError(e);
      }
    });
  }
}
