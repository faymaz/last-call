all: compile-schemas compile-translations

compile-schemas:
	glib-compile-schemas schemas/

compile-translations:
	msgfmt po/en.po -o locale/en/LC_MESSAGES/last-call.mo
	msgfmt po/tr.po -o locale/tr/LC_MESSAGES/last-call.mo

install: all
