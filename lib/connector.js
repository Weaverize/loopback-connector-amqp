// Copyright (c) 2018 Weaverize SAS <dev@weaverize.com>.
const Connector = require('loopback-connector').Connector;

var amqp;
var Models;

/**
 * Required method to setup the connector
 * @param {*} dataSource
 * @param {*} callback
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
	dataSource.connector = new AMQPConstructor(dataSource.settings, dataSource);
	dataSource.connector.dataSource = dataSource;
	linkMethods(Object.getOwnPropertyNames(dataSource.juggler.DataSource.DataAccessObject), callback);
	Models = dataSource.models;
};

/**
 * Connects the connector to the AMQP server
 * @param {*} settings
 * @param {*} datasource
 */
function AMQPConstructor(settings, datasource){
	Connector.call(this, 'amqp', settings);
	amqp = new (require('./amqp'))(settings, function() {
		console.log('connected to amqp server');
	});
}

exports.AMQP = AMQPConstructor;

/**
 * Transform a pseudo-array into a real array
 * @param {Object[]} params 
 */
function argsToArray(params) {
	return [].slice.call(params);
}

/**
 * Check if the last element of an array is a function
 * If it is, returns the function and removes it from the array
 * @param {Object[]} args 
 */
function extractCallback(args) {
	var callback;
	if (typeof args[args.length - 1] == 'function') {
		callback = args[args.length - 1];
		args.splice(args.length - 1, 1);
	}
	return callback;
}

/**
 * Handles the change stream creation request
 * @param {string} model
 * @param {*} truc
 * @param {Function} callback
 */
function proxyChangeStream(model, truc, callback){
	var stream = require('stream').Readable({
		objectMode: true,
		read: function(size) {},
	});

	amqp.on(model, function(msg) {
		stream.emit('data', msg);
	});

	callback(null, stream);
}

/**
 * Forwards the call to a static method to AMQP
 * The response is sent back through the callback
 * @param {string} model Name of the model (or "all")
 * @param {string} method Name of the method called
 * @param {object[]} params Object containing all the parameters
 */
function staticProxy(model, method, params){
	var args = argsToArray(params);
	var callback = extractCallback(args);
	if (args.length == 0)
	{
		args.push(model)
	}
	args.splice(1, 0, method);

	var topic = ['api', 'request', model, 'static', method].join('.');
	amqp.send(topic, args, callback);
}

/**
 * Forwards the call to an intance method to AMQP
 * The response is sent back through the callback
 * @param {string} model 
 * @param {number} instance 
 * @param {string} method 
 * @param {object[]} params 
 */
function instanceProxy(model, instance, method, params)
{
	var args = argsToArray(params);
	var callback = extractCallback(args);
	args.splice(0, 0, model, instance.id, method);

	var topic = ['api', 'request', model, instance.id, method].join('.');
	amqp.send(topic, args, callback);
}

/**
 * Proxy wrapper for create call
 * Extracts the id from incomming data and pass it to original callback
 * @param {string} model name of the model
 * @param {string} method name of the method (should be create)
 * @param {object[]} params array of arguments
 */
function createProxy(model, method, params)
{
	var args = argsToArray(params);
	var callback = extractCallback(args);

	var createCallback = function(err, data) {
		var id = data.id;
		callback(err, id);
	}
	args.push(createCallback);
	staticProxy(model, method, args);
}

/**
 * Links a list of methods to the proxy
 * @param {Object[]} methods
 * @param {function(Object,Object)} callback
 */
function linkMethods(methods, callback){
	methods.forEach(function(method) {
		if (method[0] != '_')		{
			AMQPConstructor.prototype[method] = function(a, b, c, d, e, f, g) {
				staticProxy(a, method, arguments);
			};
		}
	});

	//overwrite of create function
	AMQPConstructor.prototype['create'] = function(a, b, c, d, e, f, g) {
		createProxy(a, 'create', arguments);
	};

	//adds support to prototype.updateAttributes to all models
	AMQPConstructor.prototype.updateAttributes = function(a, b, c, d, e, f, g) {
		var args = argsToArray(arguments);
		args.splice(0, 2);
		instanceProxy(a, {id: b}, 'updateAttributes', args);
	};
	callback && callback();
}

/**
 * Default method called by Loopback for each Model
 * @param {object} definition object defining each Model and its methods
 */
AMQPConstructor.prototype.define = function(definition) {
	definition.model.sharedClass.methods().forEach(function(method) {
		if (method.name !== 'Change' && method.name !== 'Checkpoint') {
			method.fn = function() {
				if (method.isStatic)
				{
					staticProxy(definition.model.name, method.name, arguments);
				}
				else
				{
					instanceProxy(definition.model.name, this, method.name, arguments);
				}
			};
		}
	});
	definition.model.createChangeStream = function(truc, callback) {
		proxyChangeStream(definition.model.name, truc, callback);
	};
};
