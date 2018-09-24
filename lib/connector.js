// Copyright (c) 2018 Weaverize SAS <dev@weaverize.com>.
const Connector = require('loopback-connector').Connector;
const syncer = require("callback_sync");

var amqp;
var Models;

/**
 * Required method to setup the connector
 * @param {*} dataSource
 * @param {*} callback
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
	var sync = syncer(3, function (err, data) {
		dataSource.connected = true;
		dataSource.emit("connected");
		callback(err, data);
	});
	dataSource.connecting = true;
	dataSource.connector = new AMQPConstructor(dataSource.settings, dataSource, sync);
	dataSource.connector.dataSource = dataSource;
	linkMethods(Object.getOwnPropertyNames(dataSource.juggler.DataSource.DataAccessObject), sync);
	Models = dataSource.models;
	sync();
};

/**
 * Connects the connector to the AMQP server
 * @param {*} settings
 * @param {*} datasource
 */
function AMQPConstructor(settings, datasource, callback) {
	amqp = new (require('./amqp'))(settings, function () {
		Connector.call(this, 'amqp', settings);
		datasource.app.use(function(req, res, next) {
			req.accessToken = req.query.access_token;
			next();
		});
		callback();
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
 * Extracts the access_token from the args and returns it
 * @param {*} args 
 * @returns {string} the access_token
 */
function extractToken(args)
{
	var token = null;
	if (args[args.length - 1] && args[args.length - 1].accessToken)
	{
		token = args[args.length - 1].accessToken;
		args.pop();
	}
	return token;
}

/**
 * Handles the change stream creation request
 * @param {string} model
 * @param {*} truc
 * @param {Function} callback
 */
function proxyChangeStream(model, truc, callback) {
	var stream = require('stream').Readable({
		objectMode: true,
		read: function (size) { },
	});

	amqp.on(model, function (msg) {
		stream.emit('data', msg);
	});

	callback(null, stream);
}

/**
 * Forwards the call to an intance method to AMQP
 * The response is sent back through the callback
 * @param {string} model 
 * @param {string} instance null instance for static call
 * @param {string} method 
 * @param {object[]} params 
 */
function proxy(model, instance, method, params)
{
	var args = argsToArray(params);
	var callback = extractCallback(args);
	var token = extractToken(args);

	var payload = {
		model : model,
		method : method,
		id : (instance ? instance.id : "static"),
		token : token,
		args : args
	};

	var topic = ['api', 'request', model, (instance ? instance.id : "static"), method].join('.');
	amqp.send(topic, payload, function(err, data) {
		//FIXME: for debuging, nice place to put a breakpoint
		callback(err, data);
	});
}

/**
 * Proxy wrapper for create call
 * Extracts the id from incomming data and pass it to original callback
 * @param {string} model name of the model
 * @param {string} method name of the method (should be create)
 * @param {object[]} params array of arguments
 */
function createProxy(model, method, params) {
	var args = argsToArray(params);
	args.splice(0,1);
	var callback = extractCallback(args);

	var createCallback = function (err, data) {
		var id = data.id;
		callback(err, id);
	}
	args.push(createCallback);
	proxy(model, null, method, args);
}

/**
 * Links a list of methods to the proxy
 * @param {Object[]} methods
 * @param {function(Object,Object)} callback
 */
function linkMethods(methods, callback) {
	methods.forEach(function (method) {
		if (method[0] != '_') {
			AMQPConstructor.prototype[method] = function (a, b, c, d, e, f, g) {
				var args = argsToArray(arguments);
				args.splice(0,1);
				proxy(a, null, method, args);
			};
		}
	});

	//overwrite of create function
	AMQPConstructor.prototype['create'] = function (a, b, c, d, e, f, g) {
		var args = argsToArray(arguments);
		args.splice(0,1);
		createProxy(a, 'create', arguments);
	};

	//adds support to prototype.updateAttributes to all models
	AMQPConstructor.prototype.updateAttributes = function (a, b, c, d, e, f, g) {
		var args = argsToArray(arguments);
		args.splice(0, 2);
		proxy(a, { id: b }, 'updateAttributes', args);
	};
	callback && callback();
}

/**
 * Default method called by Loopback for each Model
 * @param {object} definition object defining each Model and its methods
 */
AMQPConstructor.prototype.define = function (definition) {
	if (definition.model.config && definition.model.config.dataSource.settings.connector == "amqp")
	{
		definition.model.sharedClass.methods().forEach(function (method) {
			//loopback internal method, left unchanged
			if (method.name !== 'Change' && method.name !== 'Checkpoint') {
				method.fn = Models[definition.model.name].fn = Models[definition.model.name][method.name] = function () {
					proxy(definition.model.name, (method.isStatic?null:this), method.name, arguments);
				};
			}
		});
		//change-stream are handled with AMQP on a dedicated queue
		definition.model.createChangeStream = function (truc, callback) {
			proxyChangeStream(definition.model.name, truc, callback);
		};

		//adds the option to send AccessToken in any cases
		for (var methodName in definition.settings.methods)
		{
			var accepts = definition.settings.methods[methodName].accepts;
			var accessTokenOption = {
				"arg": "options",
				"type": "object",
				"http": "optionsFromRequest"
			};
			if (accepts)
			{
				accepts.push(accessTokenOption);
			}
			else
			{
				definition.settings.methods[methodName].accepts = [ accessTokenOption ];
			}
		}
		
		//The ids are typed as string to avoir convertion errors with mongodb's ObjectId
		definition.model.definition._ids.forEach(function(id) {
			id.property.type = String;
		});
	}
};

/**
 * Dummy method to make sure Loopback doesn't assume that this connector doesn't require connection
 */
AMQPConstructor.prototype.connect = function () {
};
