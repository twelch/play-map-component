'use strict';
/* global mapboxgl */

var Directions = require('../index');
var directions = new Directions({
  unit: 'metric',
  profile: 'cycling',
  container: 'directions',
  accessToken: 'pk.eyJ1IjoiZW52ZW4iLCJhIjoiY2llcHYwMjk0MDAzYXdqa214eXo1MjY5ayJ9.NRXyS5w86DKA1ZZRgKpfEA'
});
