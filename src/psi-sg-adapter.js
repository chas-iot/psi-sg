/**
 * psi-sg-adapter.js - Adapter definition for PSI Sg.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const ENDPOINT = 'https://api.data.gov.sg/v1/environment/psi';
const SGTIMEZONE = 8 * 60 * 60 * 1000;  // milliseconds offset from UTC for Singapore
const HOUR = 60 * 60 * 1000;  // the API updates every hour
const MINS_OFFSET = 11 * 60 * 1000;  // request at a few mins past each hour

const manifest = require('../manifest.json');

const {PSISGDevice} = require('./psi-sg-device');
const {
  Adapter,
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

class PSISGAdapter extends Adapter {
  constructor(addonManager) {
    super(addonManager, 'gov.sg-api-Adapter', manifest.id);
    addonManager.addAdapter(this);
    this.devices = {};
    this.saved = {};

    // get current values
    this.getPSISGresults();

    setTimeout(() => {
      // get the next API update
      this.getPSISGresults();

      setInterval(() => {
        // get the update every hour thereafter
        this.getPSISGresults();
      }, HOUR);
    }, calcTimeToRefresh());
  }

  getPSISGresults() {
    const dateStr = new Date(Date.now() + SGTIMEZONE).toISOString().substring(0, 19);
    fetch(`${ENDPOINT}?date_time=${encodeURIComponent(dateStr)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`api response status: ${response.status} - ${response.statusText}`);
        }
        return response.json();
      })
      .then((json) => {
        const results = {};
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
          }
        }
        return results;
      })
      .then((apiData) => {
        for (const location in apiData) {
          const deviceId = `${manifest.id}-${location}`;
          if (!this.devices[deviceId]) {
            const device = new PSISGDevice(this, deviceId, {
              title: `Singapore ${location}`,
              description: `Singapore atmospheric pollution - ${location}`,
              '@type': ['MultiLevelSensor'],
            });
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
              prop && prop.setCachedValueAndNotify(apiData[location][propName]);
              if (propName === 'psi_twenty_four_hourly') {
                const prop2 = device.findProperty('psi_rating');
                prop2 && prop2.setCachedValueAndNotify(PSIToText(apiData[location][propName]));
              }
            }
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
