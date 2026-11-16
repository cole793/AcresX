# public/vendor

Third-party browser libraries served from this site, used by `public/report-pdf.js` to build the
property report PDF ("Download PDF") in the browser. They are self-hosted, not loaded from a CDN,
so the shared report page (`/r/<token>`, CSP `script-src 'self'; connect-src 'self'`, see
`src/services/accounts.js`) needs no CSP change, and the app and the shared page load the exact
same bytes. `report-pdf.js` loads them lazily, the first time a report view opens, with SRI
`integrity` (sha384) on the script tags.

| File | Library | Version | License | Source |
|---|---|---|---|---|
| `html2canvas-1.4.1.min.js` | html2canvas | 1.4.1 | MIT (`LICENSE-html2canvas.txt`) | npm `html2canvas@1.4.1`, `dist/html2canvas.min.js` |
| `jspdf-4.2.1.umd.min.js` | jsPDF | 4.2.1 | MIT (`LICENSE-jspdf.txt`) | npm `jspdf@4.2.1`, `dist/jspdf.umd.min.js` |

Both files are byte-identical to the npm packages and to cdnjs
(`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`,
`https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js`), unmodified, with their
license headers. The jsPDF file ends with a `sourceMappingURL` comment; the map is not shipped
(a browser's developer tools show a 404 for it, nothing else).

| File | sha256 | sha384 (SRI, base64) |
|---|---|---|
| `html2canvas-1.4.1.min.js` | `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb` | `sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H` |
| `jspdf-4.2.1.umd.min.js` | `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54` | `sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3` |

`test/report-pdf.test.js` checks these hashes against the files and against `report-pdf.js`, so
an upgrade has to update all three together:

```sh
npm pack html2canvas@<v> jspdf@<v>   # then copy the dist files above, renamed with the version
sha256sum public/vendor/*.js
openssl dgst -sha384 -binary public/vendor/<file>.js | openssl base64 -A
```
