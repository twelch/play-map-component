import { createStore, applyMiddleware, compose, bindActionCreators } from 'redux';
import thunk from 'redux-thunk';
import { decode } from 'polyline';
import utils from './utils';
import rootReducer from './reducers';
import mapboxgl from 'mapbox-gl';

//const storeWithMiddleware = applyMiddleware(thunk)(createStore);
//const store = storeWithMiddleware(rootReducer);

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
const store = createStore(rootReducer, composeEnhancers(
  applyMiddleware(thunk)
));


// State object management via redux
import * as actions from './actions';
import directionsStyle from './directions_style';

// Controls
import Inputs from './controls/inputs';
import Instructions from './controls/instructions';

export default class Directions {

  constructor(options) {
    this.actions = bindActionCreators(actions, store.dispatch);
    this.actions.setOptions(options || {});

    this.onDragDown = this._onDragDown.bind(this);
    this.onDragMove = this._onDragMove.bind(this);
    this.onDragUp = this._onDragUp.bind(this);
    this.move = this._move.bind(this);
    this.onClick = this._onClick.bind(this);

    mapboxgl.accessToken = options.accessToken;
    var map = new mapboxgl.Map({
      hash: true,
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v9',
      center: [-79.4512, 43.6568],
      zoom: 13
    });

    var button = document.createElement('button');
    button.textContent = 'click me';
    map.getContainer().querySelector('.mapboxgl-ctrl-bottom-left').appendChild(button);

    map.on('load', () => {
      button.addEventListener('click', function() {
        directions.setOrigin([-79.4512, 43.6568]);
        directions.setDestination('Montreal Quebec');
      });
    });

    var container = this._container = this.onAdd(map);

    if (this.options && this.options.position) {
        var pos = this.options.position;
        var corner = map._controlCorners[pos];
        container.className += ' mapboxgl-ctrl';
        if (pos.indexOf('bottom') !== -1) {
            corner.insertBefore(container, corner.firstChild);
        } else {
            corner.appendChild(container);
        }
    }
  }

  onAdd(map) {
    this._map = map;

    const { container, controls } = store.getState();

    this.container = container ? typeof container === 'string' ?
      document.getElementById(container) : container : this._map.getContainer();

    // Add controls to the page
    const inputEl = document.createElement('div');
    inputEl.className = 'directions-control directions-control-inputs';
    new Inputs(inputEl, store, this.actions, this._map);

    const directionsEl = document.createElement('div');
    directionsEl.className = 'directions-control-directions-container';

    new Instructions(directionsEl, store, {
      hoverMarker: this.actions.hoverMarker,
      setRouteIndex: this.actions.setRouteIndex
    }, this._map);

    if (controls.inputs) this.container.appendChild(inputEl);
    if (controls.instructions) this.container.appendChild(directionsEl);

    this.subscribedActions();
    if (this._map.loaded()) this.mapState()
    else this._map.on('load', () => this.mapState());
  }

  /**
   * Removes the control from the map it has been added to.
   *
   * @returns {Control} `this`
   */
  remove() {
      this.container.parentNode.removeChild(this.container);
      this._map = null;
      return this;
  }

  mapState() {
    const { profile, styles, interactive } = store.getState();

    // Emit any default or option set config
    this.actions.eventEmit('profile', { profile });

    const geojson = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    };

    // Add and set data theme layer/style
    this._map.addSource('directions', geojson);

    // Add direction specific styles to the map
    directionsStyle.forEach((style) => this._map.addLayer(style));

    if (styles && styles.length) styles.forEach((style) => this._map.addLayer(style));

    if (interactive) {
      this._map.on('mousedown', this.onDragDown);
      this._map.on('mousemove', this.move);
      this._map.on('click', this.onClick);

      this._map.on('touchstart', this.move);
      this._map.on('touchstart', this.onDragDown);
    }
  }

  subscribedActions() {
    store.subscribe(() => {
      const {
        origin,
        destination,
        hoverMarker,
        directions,
        routeIndex
      } = store.getState();

      const geojson = {
        type: 'FeatureCollection',
        features: [
          origin,
          destination,
          hoverMarker
        ].filter((d) => {
          return d.geometry;
        })
      };

      if (directions.length) {
        directions.forEach((feature, index) => {

          const lineString = {
            geometry: {
              type: 'LineString',
              coordinates: decode(feature.geometry, 6).map((c) => {
                return c.reverse();
              })
            },
            properties: {
              'route-index': index,
              route: (index === routeIndex) ? 'selected' : 'alternate'
            }
          };

          geojson.features.push(lineString);

          if (index === routeIndex) {
            // Collect any possible waypoints from steps
            feature.steps.forEach((d) => {
              if (d.maneuver.type === 'waypoint') {
                geojson.features.push({
                  type: 'Feature',
                  geometry: d.maneuver.location,
                  properties: {
                    id: 'waypoint'
                  }
                });
              }
            });
          }

        });
      }

      if (this._map.style && this._map.getSource('directions')) {
        this._map.getSource('directions').setData(geojson);
      }
    });
  }

  _onClick(e) {
    const { origin } = store.getState();
    const coords = [e.lngLat.lng, e.lngLat.lat];

    if (!origin.geometry) {
      this.actions.setOriginFromCoordinates(coords);
    } else {

      const features = this._map.queryRenderedFeatures(e.point, {
        layers: [
          'directions-origin-point',
          'directions-destination-point',
          'directions-waypoint-point',
          'directions-route-line-alt'
        ]
      });

      if (features.length) {

        // Remove any waypoints
        features.forEach((f) => {
          if (f.layer.id === 'directions-waypoint-point') {
            this.actions.removeWaypoint(f);
          }
        });

        if (features[0].properties.route === 'alternate') {
          const index = features[0].properties['route-index'];
          this.actions.setRouteIndex(index);
        }
      } else {
        this.actions.setDestinationFromCoordinates(coords);
        this._map.flyTo({ center: coords });
      }
    }
  }

  _move(e) {
    const { hoverMarker } = store.getState();

    const features = this._map.queryRenderedFeatures(e.point, {
      layers: [
        'directions-route-line-alt',
        'directions-route-line',
        'directions-origin-point',
        'directions-destination-point',
        'directions-hover-point'
      ]
    });

    this._map.getCanvas().style.cursor = features.length ? 'pointer' : '';

    if (features.length) {
      this.isCursorOverPoint = features[0];
      this._map.dragPan.disable();

      // Add a possible waypoint marker when hovering over the active route line
      features.forEach((feature) => {
        if (feature.layer.id === 'directions-route-line') {
          this.actions.hoverMarker([e.lngLat.lng, e.lngLat.lat]);
        } else if (hoverMarker.geometry) {
          this.actions.hoverMarker(null);
        }
      });

    } else if (this.isCursorOverPoint) {
      this.isCursorOverPoint = false;
      this._map.dragPan.enable();
    }
  }

  _onDragDown() {
    if (!this.isCursorOverPoint) return;
    this.isDragging = this.isCursorOverPoint;
    this._map.getCanvas().style.cursor = 'grab';

    this._map.on('mousemove', this.onDragMove);
    this._map.on('mouseup', this.onDragUp);

    this._map.on('touchmove', this.onDragMove);
    this._map.on('touchend', this.onDragUp);
  }

  _onDragMove(e) {
    if (!this.isDragging) return;

    const coords = [e.lngLat.lng, e.lngLat.lat];
    switch (this.isDragging.layer.id) {
      case 'directions-origin-point':
        this.actions.createOrigin(coords);
      break;
      case 'directions-destination-point':
        this.actions.createDestination(coords);
      break;
      case 'directions-hover-point':
        this.actions.hoverMarker(coords);
      break;
    }
  }

  _onDragUp() {
    if (!this.isDragging) return;

    const { hoverMarker, origin, destination } = store.getState();

    switch (this.isDragging.layer.id) {
      case 'directions-origin-point':
        this.actions.setOriginFromCoordinates(origin.geometry.coordinates);
      break;
      case 'directions-destination-point':
        this.actions.setDestinationFromCoordinates(destination.geometry.coordinates);
      break;
      case 'directions-hover-point':
        // Add waypoint if a sufficent amount of dragging has occurred.
        if (hoverMarker.geometry && !utils.coordinateMatch(this.isDragging, hoverMarker)) {
          this.actions.addWaypoint(0, hoverMarker);
        }
      break;
    }

    this.isDragging = false;
    this._map.getCanvas().style.cursor = '';

    this._map.off('touchmove', this.onDragMove);
    this._map.off('touchend', this.onDragUp);

    this._map.off('mousemove', this.onDragMove);
    this._map.off('mouseup', this.onDragUp);
  }

  // API Methods
  // ============================

  /**
   * Turn on or off interactivity
   * @param {Boolean} state sets interactivity based on a state of `true` or `false`.
   * @returns {Directions} this
   */
  interactive(state) {
    if (state) {
      this._map.on('touchstart', this.move);
      this._map.on('touchstart', this.onDragDown);

      this._map.on('mousedown', this.onDragDown);
      this._map.on('mousemove', this.move);
      this._map.on('click', this.onClick);
    } else {
      this._map.off('touchstart', this.move);
      this._map.off('touchstart', this.onDragDown);

      this._map.off('mousedown', this.onDragDown);
      this._map.off('mousemove', this.move);
      this._map.off('click', this.onClick);
    }

    return this;
  }

  /**
   * Returns the origin of the current route.
   * @returns {Object} origin
   */
  getOrigin() {
    return store.getState().origin;
  }

  /**
   * Sets origin. _Note:_ calling this method requires the [map load event](https://www.mapbox.com/mapbox-gl-js/api/#Map.load)
   * to have run.
   * @param {Array<number>|String} query An array of coordinates [lng, lat] or location name as a string.
   * @returns {Directions} this
   */
  setOrigin(query) {
    if (typeof query === 'string') {
      this.actions.queryOrigin(query);
    } else {
      this.actions.setOriginFromCoordinates(query);
    }

    return this;
  }

  /**
   * Returns the destination of the current route.
   * @returns {Object} destination
   */
  getDestination() {
    return store.getState().destination;
  }

  /**
   * Sets destination. _Note:_ calling this method requires the [map load event](https://www.mapbox.com/mapbox-gl-js/api/#Map.load)
   * to have run.
   * @param {Array<number>|String} query An array of coordinates [lng, lat] or location name as a string.
   * @returns {Directions} this
   */
  setDestination(query) {
    if (typeof query === 'string') {
      this.actions.queryDestination(query);
    } else {
      this.actions.setDestinationFromCoordinates(query);
    }

    return this;
  }

  /**
   * Swap the origin and destination.
   * @returns {Directions} this
   */
  reverse() {
    this.actions.reverse();
    return this;
  }

  /**
   * Add a waypoint to the route. _Note:_ calling this method requires the
   * [map load event](https://www.mapbox.com/mapbox-gl-js/api/#Map.load) to have run.
   * @param {Number} index position waypoint should be placed in the waypoint array
   * @param {Array<number>|Point} waypoint can be a GeoJSON Point Feature or [lng, lat] coordinates.
   * @returns {Directions} this;
   */
  addWaypoint(index, waypoint) {
    if (!waypoint.type) waypoint = utils.createPoint(waypoint, { id: 'waypoint' });
    this.actions.addWaypoint(index, waypoint);
    return this;
  }

  /**
   * Change the waypoint at a given index in the route. _Note:_ calling this
   * method requires the [map load event](https://www.mapbox.com/mapbox-gl-js/api/#Map.load)
   * to have run.
   * @param {Number} index indexed position of the waypoint to update
   * @param {Array<number>|Point} waypoint can be a GeoJSON Point Feature or [lng, lat] coordinates.
   * @returns {Directions} this;
   */
  setWaypoint(index, waypoint) {
    if (!waypoint.type) waypoint = utils.createPoint(waypoint, { id: 'waypoint' });
    this.actions.setWaypoint(index, waypoint);
    return this;
  }

  /**
   * Remove a waypoint from the route.
   * @param {Number} index position in the waypoints array.
   * @returns {Directions} this;
   */
  removeWaypoint(index) {
    const { waypoints } = store.getState();
    this.actions.removeWaypoint(waypoints[index]);
    return this;
  }

  /**
   * Fetch all current waypoints in a route.
   * @returns {Array} waypoints
   */
  getWaypoints() {
    return store.getState().waypoints;
  }

  /**
   * Subscribe to events that happen within the plugin.
   * @param {String} type name of event. Available events and the data passed into their respective event objects are:
   *
   * - __clear__ `{ type: } Type is one of 'origin' or 'destination'`
   * - __loading__ `{ type: } Type is one of 'origin' or 'destination'`
   * - __profile__ `{ profile } Profile is one of 'driving', 'walking', or 'cycling'`
   * - __origin__ `{ feature } Fired when origin is set`
   * - __destination__ `{ feature } Fired when destination is set`
   * - __route__ `{ route } Fired when a route is updated`
   * - __error__ `{ error } Error as string
   * @param {Function} fn function that's called when the event is emitted.
   * @returns {Directions} this;
   */
  on(type, fn) {
    this.actions.eventSubscribe(type, fn);
    return this;
  }
}
