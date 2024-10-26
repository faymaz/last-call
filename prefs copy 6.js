'use strict';

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class LastCallPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings('org.gnome.shell.extensions.last-call');

    const page = new Adw.PreferencesPage();
    window.add(page);

    const group = new Adw.PreferencesGroup();
    page.add(group);

    const comboRow = new Adw.ComboRow({
      title: _('Şehir Seçin:'),
    });
    group.add(comboRow);

    // Şehir verilerini doğrudan burada tanımlıyoruz
    const cities = [
      { name: 'Mörfelden-Walldorf', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/10214/' },
      { name: 'Tuttlingen', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/11083/' },
      { name: 'Costa Mesa', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8608/' },
      { name: 'Irvine', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8622/' },
      { name: 'Clifton', url: 'https://namazvakitleri.diyanet.gov.tr/en-US/8869/' },
    ];

    const stringList = new Gtk.StringList();
    for (const city of cities) {
      stringList.append(city.name);
    }
    comboRow.model = stringList;

    const activeIndex = cities.findIndex((c) => c.name === settings.get_string('selected-city'));
    comboRow.selected = activeIndex >= 0 ? activeIndex : 0;

    comboRow.connect('notify::selected', () => {
      const activeCity = comboRow.model.get_string(comboRow.selected);
      settings.set_string('selected-city', activeCity);
    });
  }
}
