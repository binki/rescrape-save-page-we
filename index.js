#!/usr/bin/env node
const fetch = require('node-fetch');
const {
  createWriteStream,
  writeFile,
} = require('fs');
const gulpLock = require('gulp-lock');
const {
  JSDOM,
} = require('jsdom');
const maputil = require('maputil');
const path = require('path');
const URL = require('url').URL;

throw new Error('Do not run this script again. All of the files were removed from the wordpress server. Running this script will overwrite existing files with junk.');

async function writeFileAsync(file, data, options) {
  return new Promise((resolve, reject) => {
    writeFile(file, data, options, ex => ex ? reject(ex) : resolve());
  });
}

const downloadConcurrencyLock = gulpLock(16);

async function downloadToFile(uri, file) {
  await downloadConcurrencyLock.promise(async () => {
    console.log(`Fetching ${uri}…`);
    const fetchResult = await fetch(uri);
    console.log(`Saving to ${uri} to ${file}…`);
    const destinationStream = createWriteStream(file);
    fetchResult.body.pipe(destinationStream);
    await new Promise((resolve, reject) => {
      destinationStream.on('error', reject);
      destinationStream.on('close', resolve);
    });
  })();
  console.log(`Saved ${file}`);
  return file;
}

function buildMemoizedDownloadToFile() {
  const requestedUris = new Map();
  const usedFiles = new Set();
  return function(uri) {
    // Some parts of the site use http: and others https:, so
    // normalize to avoid errors.
    uri = uri.replace(/^http:/, 'https:');
    return maputil.getOrSet(requestedUris, uri, async () => {
      const file = (function () {
        const sourceFile = uriGetFile(uri);
        const parts = sourceFile.split('.');
        for (let i = 0;; i++) {
          const file = (i === 0 ? parts : [].concat(parts.slice(0, parts.length - 1), [`${i}`, parts[parts.length - 1]])).join('.');
          if (!usedFiles.has(file)) {
            usedFiles.add(file);
            return file;
          }
        }
      })();
      return await downloadToFile(uri, file);
    });
  };
}

function uriGetFile(uri) {
  const aUrl = new URL(uri);
  const urlFilePortion = /[^\/]+$/.exec(aUrl.pathname)[0];
  // Try to avoid Windows-specific path cheating.
  const file =  urlFilePortion && urlFilePortion.replace(/\\/g, '_');
  if (!file) {
    throw new Error(`Unable to calculate filename from URI ${aUrl}`);
  }
  return file;
}

async function mainAsync(file) {
  const dom = await JSDOM.fromFile(file);
  const memoizedDownloadToFile = buildMemoizedDownloadToFile();
  // Remove troublesome <base/> element which twists all relative
  // links.
  for (const baseElement of dom.window.document.querySelectorAll('base')) {
    baseElement.remove();
  }
  await Promise.all([].concat(Array.from(dom.window.document.querySelectorAll('a')).map(async a => {
    const uriString = a.href;
    if (/wp-content\/uploads/.test(uriString)) {
      a.href = await memoizedDownloadToFile(a.href);
    }
  }), Array.from(dom.window.document.querySelectorAll('img')).map(async img => {
    const uriCandidates = [];
    const {
      savepageSrc,
      savepageSrcset,
    } = img.dataset;
    if (savepageSrc) {
      uriCandidates.push({
        uri: savepageSrc,
        save: uri => img.src = uri,
      });
    }
    if (savepageSrcset) {
      for (const srcsetEntry of savepageSrcset.split(/,/)) {
        const srcsetParts = srcsetEntry.trim().split(/ +/);
        if (srcsetParts.length === 2) {
          uriCandidates.push({
            uri: srcsetParts[0],
            save: uri => img.srcset = [].concat(img.srcset.split(',').map(x => x.trim()).filter(x => x), `${uri} ${srcsetParts[1]}`).join(', '),
          });
        } else {
          console.log(`Confused by srcset="${savepageSrcset}"`);
        }
      }
    }
    const downloadedUris = await Promise.all(uriCandidates.map(async uriCandidate => {
      const {
        uri,
        save,
      } = uriCandidate;
      const destinationFile = await memoizedDownloadToFile(uri);
      // The order of srcset matters, so wait for everything to
      // download prior to actually calling save().
      return {
        save,
        destinationFile,
      };
    }));
    for (const downloadedUri of downloadedUris) {
      const {
        save,
        destinationFile,
      } = downloadedUri;
      save(destinationFile);
    }
  })));
  await writeFileAsync(`${file}.offline.html`, dom.serialize());
}
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error(`Must provide a path to a filename to process. Got ${args.length} parameters; expecting 1.`);
  process.exitCode = 1;
} else {
  mainAsync(args[0]);
}
