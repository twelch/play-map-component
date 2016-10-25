'use strict';
/* global mapboxgl */

var Directions = require('../index');
var directions = new Directions({
  unit: 'metric',
  profile: 'cycling',
  container: 'directions',
  accessToken: 'ADD_MAPBOX_TOKEN'
});
