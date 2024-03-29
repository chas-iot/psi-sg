/**
 * psi-sg-adapter.js - Adapter definition for PSI Sg.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const ENDPOINT_PSI = 'https://api.data.gov.sg/v1/environment/psi';
const ENDPOINT_PM25 = 'https://api.data.gov.sg/v1/environment/pm25';
const SGTIMEZONE = 8 * 60 * 60 * 1000;  // milliseconds offset from UTC for Singapore
const HOUR = 60 * 60 * 1000;            // the API updates every hour
const MINS_OFFSET = 11 * 60 * 1000;     // request at a few mins past each hour
const HIGH_TIME = '9999-99-99ZZZ';      // a date-time string exceeding any possible API timestamp

const manifest = require('../manifest.json');

const {PSISGDevice} = require('./psi-sg-device');
const {
  Adapter,
  Database,
  Event,
} = require('gateway-addon');

const fetch = require('node-fetch');

// calculate the required delay to the next API update
function calcTimeToRefresh() {
  const now = Date.now();
  return ((Math.floor(now / HOUR) + 1) * HOUR) - now + MINS_OFFSET;
}

function PSIToText(r) {
  /* eslint-disable curly */
  if (r < 51) return 'Good';
  if (r < 101) return 'Moderate';
  if (r < 201) return 'Unhealthy';
  if (r < 301) return 'Very Unhealthy';
  /* eslint-enable curly */
  return 'Hazardous';
}

function PM25ToText(r) {
  /* eslint-disable curly */
  if (r < 56) return 'Normal';
  if (r < 151) return 'Elevated';
  if (r < 251) return 'High';
  /* eslint-enable curly */
  return 'Very High';
}

class PSISGAdapter extends Adapter {
  constructor(addonManager) {
    super(addonManager, 'gov.sg-api-Adapter', manifest.id);
    addonManager.addAdapter(this);
    this.devices = {};
    this.saved = {};
    this.db = new Database(manifest.id);
    this.db.open()
      .then(() => {
        return this.db.loadConfig();
      })
      .then((config) => {
        this.hide_sub_index = config.hide_sub_index;
        this.debug_level = config.debug_level || 0;
        this.timestamp = HIGH_TIME;

        // immediately get current values
        this.getResults(ENDPOINT_PSI, 'psi_twenty_four_hourly', 'psi_rating', PSIToText);
        this.getResults(ENDPOINT_PM25, 'pm25_one_hourly', 'pm25_rating', PM25ToText);

        setTimeout(() => {
          this.timestamp = HIGH_TIME;

          // schedule the next API update
          this.getResults(ENDPOINT_PSI, 'psi_twenty_four_hourly', 'psi_rating', PSIToText);
          this.getResults(ENDPOINT_PM25, 'pm25_one_hourly', 'pm25_rating', PM25ToText);

          setInterval(() => {
            this.timestamp = HIGH_TIME;

            // get the update every hour thereafter
            this.getResults(ENDPOINT_PSI, 'psi_twenty_four_hourly', 'psi_rating', PSIToText);
            this.getResults(ENDPOINT_PM25, 'pm25_one_hourly', 'pm25_rating', PM25ToText);
          }, HOUR);
        }, calcTimeToRefresh());
      })
      .catch((e) => {
        console.error(e);
      });
  }

  getResults(endpoint, srcName, dstName, convert) {
    const dateStr = new Date(Date.now() + SGTIMEZONE).toISOString().substring(0, 19);
    const queryStr = `${endpoint}?date_time=${encodeURIComponent(dateStr)}`;
    fetch(queryStr)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`api query ${queryStr}
        returned status: ${response.status} - ${response.statusText}`);
        }
        return response.json();
      })
      .then((json) => {
        this.debug_level >= 1 && console.debug('received response to', queryStr);
        this.debug_level >= 2 && console.debug(JSON.stringify(json, null, 2));
        const results = {};
        let empty = true;
        const t1 = json.items[0].update_timestamp;
        if (t1) {
          const t2 = `${t1.substring(0, 10)}\n${t1.substring(11, 19)}`;
          if (t2 < this.timestamp) {
            // we get 2 different timestamps from the two queries
            //   show the earlier so more obvious when one of the datasets is stale
            this.timestamp = t2;
          }
        }
        json.region_metadata.forEach((item) => {
          results[item.name] = {
            name: item.name,
            latitude: item.label_location.latitude,
            longitude: item.label_location.longitude,
          };
        });
        for (const location in results) {
          for (const index in json.items[0].readings) {
            results[location][index] = json.items[0].readings[index][location];
            empty = false;
          }
        }
        if (empty) {
          throw new Error(`api query ${queryStr}
        returned empty results:
${JSON.stringify(json, null, 2)}`);
        }
        return results;
      })
      .then((apiData) => {
        for (const location in apiData) {
          const deviceId = `${manifest.id}-${location}`;
          if (!this.devices[deviceId]) {
            const device = new PSISGDevice(
              this,
              deviceId, {
                title: `Singapore ${location}`,
                description: `Singapore atmospheric pollution - ${location}`,
                '@type': ['MultiLevelSensor'],
              },
              this.hide_sub_index);
            this.handleDeviceAdded(device);
            if (this.saved[deviceId]) {
              this.devices[deviceId].saved = true;
              delete this.saved[deviceId];
            }
          }
          const device = this.devices[deviceId];
          if (device) {
            for (const propName in apiData[location]) {
              const prop = device.findProperty(propName);
              if (prop) {
                // directly update and notify properties, as we want to propagate unchanged values
                // so that the downstream graphing (if any) displays the correct hourly values
                prop.setCachedValue(apiData[location][propName]);
                device.notifyPropertyChanged(prop);
              }
              if (propName === srcName) {
                const prop2 = device.findProperty(dstName);
                prop2 && prop2.setCachedValueAndNotify(convert(apiData[location][propName]));
              }
            }
            const p = device.findProperty('time_stamp');
            p && p.setCachedValueAndNotify(this.timestamp);
          }
        }
      })
      .catch((e) => {
        console.error(e);
        for (const deviceId in this.devices) {
          const device = this.devices[deviceId];
          device.saved &&
            device.eventNotify(new Event(device, 'APIerror', e.message));
        }
      });
  }

  addDevice(deviceId) {
    return new Promise((resolve, reject) => {
      if (deviceId in this.devices) {
        reject(`addDevice: ${deviceId} already exists.`);
      } else {
        console.error(`addDevice: ${deviceId} - do not know how to handle.`);
        reject(`addDevice: ${deviceId} - do not know how to handle.`);
        // const device = new PSISGAdapter(this, deviceId, deviceDescription);
        // this.handleDeviceAdded(device);
        // resolve(device);
      }
    });
  }

  removeDevice(deviceId) {
    return new Promise((resolve, reject) => {
      const device = this.devices[deviceId];
      if (device) {
        this.handleDeviceRemoved(device);
        resolve(device);
      } else {
        reject(`Device: ${deviceId} not found.`);
      }
    });
  }

  handleDeviceSaved(deviceId) {
    if (this.devices[deviceId]) {
      this.devices[deviceId].saved = true;
    } else {
      this.saved[deviceId] = true;
    }
  }

}

module.exports = {PSISGAdapter};
