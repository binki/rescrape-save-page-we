This takes HTML files which were downloaded with Save Page WE and tries to fix up links to external resources by downloading them.
It is currently hardcoded to support downloading from a WordPress installation by limiting the links to `wp-content/uploads` (this would need to be changed to support general scenarios).
It outputs the modified HTML (which is updated to refer to the downloaded files) to `original-name.offline.html`.

I was using Save Page WE 9.9 at the time.
It seems like it failed to save `<img/>` tags using srcsets or maybe had issues because the DHS Band website I was downloading contained `<base/>`.
