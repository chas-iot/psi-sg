/**
 * psi-sg-device.js - Device definitions for PSI Sg.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const PSISG_PROPERTIES = {
  psi_twenty_four_hourly: {
    title: 'Pollutant Standards Index',
    '@type': 'LevelProperty',
    type: 'integer',
    description: 'Pollutant Standards Index',
    minimum: 0,
    maximum: 500,
    readOnly: true,
  },
  pm25_sub_index: {
    title: '2.5 micron Particulate Matter sub-index',
    type: 'integer',
    description: 'computed based on 24-hour average PM2.5 reading, then normalised to 0-500 range',
    readOnly: true,
  },
  pm10_sub_index: {
    title: '10 micron Particulate Matter sub-index',
    type: 'integer',
    description: 'computed based on 24-hour average PM10 reading, then normalised to 0-500 range',
    readOnly: true,
  },
  o3_sub_index: {
    title: 'Ozone sub-index',
    type: 'integer',
    description: 'computed based on 8-hour average Ozone reading, then normalised to 0-500 range',
    readOnly: true,
  },
  so2_sub_index: {
    title: 'Sulphur Dioxide sub-index',
    type: 'integer',
    // eslint-disable-next-line max-len
    description: 'computed based on 24-hour average Sulphur Dioxide reading, then normalised to 0-500 range',
    readOnly: true,
  },
  co_sub_index: {
    title: 'Carbon Monoxide sub-index',
    type: 'integer',
    // eslint-disable-next-line max-len
    description: 'computed based on 8-hour average Carbon Monoxide reading, then normalised to 0-500 range',
    readOnly: true,
  },
  no2_sub_index: {
    title: 'Nitrogen Dioxide sub-index',
    type: 'integer',
    // eslint-disable-next-line max-len
    description: 'computed based on 1-hour average Nitrogen Dioxide reading, then normalised to 0-500 range',
    readOnly: true,
  },
  psi_rating: {
    title: 'PSI Air Quality Indicator',
    type: 'string',
    readOnly: true,
  },
  pm25_one_hourly: {
    title: `PM25:
2.5 micron Particulate Matter concentr'n`,
    type: 'integer',
    description: `1-hr PM₂.₅ reading`,
    readOnly: true,
    unit: 'µg/m³',
  },
  pm25_rating: {
    title: 'PM25 Indicator',
    type: 'string',
    readOnly: true,
  },
};

const {
  Device,
  Property,
} = require('gateway-addon');

class PSISGDevice extends Device {
  constructor(adapter, id, deviceDescription) {
    super(adapter, id);
    this.title = deviceDescription.title;
    this.description = deviceDescription.description;
    this['@type'] = deviceDescription['@type'];
    for (const propertyName in PSISG_PROPERTIES) {
      const property = new Property(this, propertyName, PSISG_PROPERTIES[propertyName]);
      this.properties.set(propertyName, property);
    }
    this.addEvent('APIerror',
                  {title: 'API error',
                   description: 'Details of an error encountered while using the PSI API',
                   type: 'string'});
    this.links = [{rel: 'alternate',
                   mediaType: 'text/html',
                   href: 'https://www.haze.gov.sg/resources/readings-over-the-last-24-hours'}];
  }
}

module.exports = {PSISG_PROPERTIES, PSISGDevice};
