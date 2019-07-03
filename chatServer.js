// ***************************************************************************
// General
// ***************************************************************************

const conf = { 
    port: 8888,
    debug: false,
    dbPort: 6379,
    dbHost: '127.0.0.1',
    dbOptions: {},
    mainroom: 'MainRoom'
};

// External dependencies
const express = require('express');
const http = require('http');
const events = require('events');
const _ = require('underscore');
const bodyParser = require('body-parser');

// HTTP Server configuration & launch
const app = express();
const router = express.Router();
const server = http.createServer(app);

server.listen(conf.port);

const io = require('socket.io')(server);
const redis = require('socket.io-redis');
io.adapter(redis({ host: conf.dbHost, port: conf.dbPort }));

const db = require('redis').createClient(conf.dbPort,conf.dbHost);

// Logger configuration
const logger = new events.EventEmitter();
logger.on('newEvent', function(event, data) {
    // Console log
    const time = new Date();
    console.log('%s: %s (%j)', event, JSON.stringify(data), time);
    // Persistent log storage too?
    // TODO
});

// ***************************************************************************
// Express routes helpers
// ***************************************************************************

// Only authenticated users should be able to use protected methods
var requireAuthentication = function(req, res, next) {
    // TODO
    next();
};

// Send a message to all active rooms
var sendBroadcast = function(text) {
    _.each(io.nsps['/'].adapter.rooms, function(sockets, room) {
        console.log('TESBROADCAST-sockets', sockets);
        console.log('TESBROADCAST-room', room);
        var message = {'room':room, 'username':'ServerBot', 'msg':text, 'date':new Date()};
        io.to(room).emit('newMessage', message);
    });
    logger.emit('newEvent', 'newBroadcastMessage', {'msg':text});
};

// ***************************************************************************
// Express routes
// ***************************************************************************

// Welcome message
router.get('/', function(req, res) {
    res.send("Welcome to chat server");
});

router.get('/rooms', (req, res) => {
  const data = io.sockets.adapter.rooms;
  const connected = io.sockets.connected;
  Object.keys(connected).forEach(key => {
    console.log('***', key);
  });

  const result = {
    rooms: data
  };
  res.send(result);
});

router.get('/rooms/:name/users', (req, res) => {
  const roomName = req.params.name;
  const data = io.sockets.adapter.rooms;
  const result = {
    users: data[roomName]
  };
  res.send(result);
});

app.use(router);
app.use(bodyParser.json());

// Broadcast message to all connected users
app.post('/api/broadcast/', requireAuthentication, (req, res) => {
    sendBroadcast(req.body.msg);
    res.status(201).send( "Message sent to all rooms");
}); 

// ***************************************************************************
// Socket.io events
// ***************************************************************************

io.sockets.on('connection', function(socket) {

    // Welcome message on connection
    socket.emit('connected', 'Welcome to the chat server');
    logger.emit('newEvent', 'userConnected', {'socket':socket.id});

    // Store user data in db
    db.hset([socket.id, 'connectionDate', new Date()], redis.print);
    db.hset([socket.id, 'socketID', socket.id], redis.print);
    db.hset([socket.id, 'username', 'anonymous'], redis.print);

    // Join user to 'MainRoom'
    socket.join(conf.mainroom);
    logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'room':conf.mainroom});
    // Confirm subscription to user
    socket.emit('subscriptionConfirmed', {'room':conf.mainroom});
    // Notify subscription to all users in room
    var data = {'room':conf.mainroom, 'username':'anonymous', 'msg':'----- Joined the room -----', 'id':socket.id};
    io.to(conf.mainroom).emit('userJoinsRoom', data);

    // User wants to subscribe to [data.rooms]
    socket.on('subscribe', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {

            // Subscribe user to chosen rooms
            _.each(data.rooms, function(room) {
                room = room.replace(" ","");
                socket.join(room);
                logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'username':username, 'room':room});

                // Confirm subscription to user
                socket.emit('subscriptionConfirmed', {'room': room});
        
                // Notify subscription to all users in room
                var message = {'room':room, 'username':username, 'msg':'----- Joined the room -----', 'id':socket.id};
                io.to(room).emit('userJoinsRoom', message);
            });
        });
    });

    // User wants to unsubscribe from [data.rooms]
    socket.on('unsubscribe', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {
        
            // Unsubscribe user from chosen rooms
            _.each(data.rooms, function(room) {
                if (room != conf.mainroom) {
                    socket.leave(room);
                    logger.emit('newEvent', 'userLeavesRoom', {'socket':socket.id, 'username':username, 'room':room});
                
                    // Confirm unsubscription to user
                    socket.emit('unsubscriptionConfirmed', {'room': room});
        
                    // Notify unsubscription to all users in room
                    var message = {'room':room, 'username':username, 'msg':'----- Left the room -----', 'id': socket.id};
                    io.to(room).emit('userLeavesRoom', message);
                }
            });
        });
    });

    // User wants to know what rooms he has joined
    socket.on('getRooms', function(data) {
        socket.emit('roomsReceived', socket.rooms);
        logger.emit('newEvent', 'userGetsRooms', {'socket':socket.id});
    });

    // Get users in given room
    socket.on('getUsersInRoom', function(data) {
        var usersInRoom = [];
        // var socketsInRoom = _.keys(io.nsps['/'].adapter.rooms[data.room]);
        var socketsInRoom = _.keys(io.sockets.adapter.rooms[data.room].sockets);
        console.log('SOCKETINROOM', socketsInRoom);
        for (var i=0; i<socketsInRoom.length; i++) {
            db.hgetall(socketsInRoom[i], function(err, obj) {

              if (!obj) return;

              usersInRoom.push({'room':data.room, 'username':obj.username, 'id':obj.socketID});
              // When we've finished with the last one, notify user
              if (usersInRoom.length == socketsInRoom.length) {
                  socket.emit('usersInRoom', {'users':usersInRoom});
              }
            });
        }
    });

    // User wants to change his nickname
    socket.on('setNickname', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {

            // Store user data in db
            db.hset([socket.id, 'username', data.username], redis.print);
            logger.emit('newEvent', 'userSetsNickname', {'socket':socket.id, 'oldUsername':username, 'newUsername':data.username});

            // Notify all users who belong to the same rooms that this one
            _.each(socket.rooms, function(room) {
                if (room) {
                    var info = {'room':room, 'oldUsername':username, 'newUsername':data.username, 'id':socket.id};
                    io.to(room).emit('userNicknameUpdated', info);
                }
            });
        });
    });

    // New message sent to group
    socket.on('newMessage', function(data) {
        console.log('NEW MESSAGE FROM SOCKET:', socket.id);
        db.hgetall(socket.id, function(err, obj) {
            if (err) return logger.emit('newEvent', 'error', err);
            // Check if user is subscribed to room before sending his message
            if (_.contains(_.values(socket.rooms), data.room)) {
                var message = {'room':data.room, 'username':obj.username, 'msg':data.msg, 'date':new Date()};
                // Send message to room
                io.to(data.room).emit('newMessage', message);
                logger.emit('newEvent', 'newMessage', message);
            }
        });
    });

    // Clean up on disconnect
    socket.on('disconnect', function() {
        
        // Get current rooms of user
        var rooms = socket.rooms;
        
        // Get user info from db
        db.hgetall(socket.id, function(err, obj) {
            if (err) return logger.emit('newEvent', 'error', err);
            if (!obj) return;
            logger.emit('newEvent', 'userDisconnected', {'socket':socket.id, 'username':obj.username});

            // Notify all users who belong to the same rooms that this one
            _.each(rooms, function(room) {
                if (room) {
                    var message = {'room':room, 'username':obj.username, 'msg':'----- Left the room -----', 'id':obj.socketID};
                    io.to(room).emit('userLeavesRoom', message);
                }
            });
        });
    
        // Delete user from db
        db.del(socket.id, redis.print);
    });
});

// Automatic message generation (for testing purposes)
if (conf.debug) {
    setInterval(function() {
        var text = 'Testing rooms';
        sendBroadcast(text);
    }, 60000);
}

