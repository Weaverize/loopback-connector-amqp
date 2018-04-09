// Copyright (c) 2018 Weaverize SAS <dev@weaverize.com>.
const amqp = require('amqplib/callback_api');
const uuid = require('uuid/v4');
const events = require('events');
const syncer = require("callback_sync");

module.exports = class amqpFront extends events.EventEmitter {

	/**
	 * Connects to RabbitMQ and create exchange if needed
	 * @param {Object} settings AMQP connection settings
	 * @param {function()} callback called when ready
	 */
	constructor(settings, callback) {
		super();

		/**
		 * channel AMQP
		 */
		this.channel = null;

		/**
		 * Private AMQP reply_to queue
		 */
		this.queue = null;

		this.responseHandler = this.responseHandler.bind(this);
		this.onChange = this.onChange.bind(this);

		/**
		 * AMQP connection settings
		 */
		this.settings = settings;
		amqpFront.defaults(settings);
		var that = this;
		amqp.connect(settings.url, function (err, conn) {
			if (!err) {
				var sync = syncer(2, callback);
				conn.createChannel(function (err, ch) {
					that.channel = ch;
					that.channel.assertExchange(settings.exchange, 'topic', { durable: true });
					that.channel.assertQueue('', { exclusive: true }, function (err, q) {
						that.queue = q;
						that.channel.consume(that.queue.queue, that.responseHandler, {
							noAck: true,
						});
						sync();
					});
					that.channel.assertQueue('', { exclusive: true }, function (err, q) {
						that.channel.bindQueue(q.queue, that.settings.exchange, settings.binding + '.changes.#', {});
						that.channel.consume(q.queue, that.onChange, {
							noAck: true,
						});
						sync();
					});
				});
			} else {
				console.log(err);
				console.log("is the port corresponding to the server's 5672 port ?");
			}
		});

		/**
		 * Map of the registered callback for the responses
		*/
		this.responses = {};
	}

	/**
	 * Check the parameters and add default value if needed
	 * @param {Object} settings
	 */
	static defaults(settings) {
		settings.host = settings.host || '127.0.0.1';
		settings.port = settings.port || 5672;
		settings.exchange = settings.exchange || 'loopback';
		settings.binding = settings.binding || 'loopback';
		settings.login = settings.login || '';
		settings.password = settings.password || '';
		var login = '';
		if (settings.password)
			settings.login += ':' + settings.password;
		if (settings.login)
			login += settings.login + '@';
		settings.url = settings.url || 'amqp://' + login + settings.host + ':' + settings.port;
	}

	/**
	 * Transmit the response to the corresponding callback
	 * @param {Object} resp
	 */
	responseHandler(resp) {
		var callback = this.responses[resp.properties.correlationId];
		if (callback) {
			delete this.responses[resp.properties.correlationId];
			var msg = resp.content.toString();
			var respObj = JSON.parse(msg);
			callback(respObj.err, respObj.data);
		} else {
			console.log('received unexpected response:', resp);
		}
	}

	/**
	 * Send the messsage object (msg) to the topic key (key)
	 * Also registers the callback for the response
	 * @param {string} key of the Topic
	 * @param {Object} msg object to send
	 * @param {function(Object,Object)} callback for the response
	 */
	send(key, msg, callback) {
		var payload = msg;
		if (typeof msg == 'object') {
			payload = new Buffer(JSON.stringify(msg));
		}

		var id = uuid();
		this.responses[id] = callback;

		this.channel.publish(this.settings.exchange, key, payload, {
			replyTo: this.queue.queue,
			correlationId: id,
		});
	}

	/**
	 * Broadcast every changes as events
	 * @param {object} msg incoming AMQP message
	 */
	onChange(msg) {
		var model = msg.fields.routingKey.split('.')[2];
		var respObj = JSON.parse(msg.content.toString());
		this.emit(model, respObj);
	}
}