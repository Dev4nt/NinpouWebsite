'use strict';

var mongoose = require('mongoose');
var express = require('express');
var moment = require('moment');
var router = express.Router();
var Game = require('../models/Game');
var Stat = require('../models/Stat');
var Hero = require('../models/Hero');
var HeroStat = require('../models/HeroStat');
var Alias = require('../models/Alias');
var Calculator = require('./calculator');
var StatCalculator = require('./statcalculator');
var Decoder = require('./decoder');
var Code = require('../models/Code');

function getPlayerAlias(alias, callback) {
	Alias.findOne({ alias: alias.toLowerCase() }, function(err, alias) {
		if (err) return callback(err);
		else if (!alias) return callback(null); 
		else return callback(null, alias.username);
	});
};

function dateFromObjectId(objectId) {
	return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
};

function objectIdFromDate(date) {
	return Math.floor(date.getTime() / 1000).toString(16) + "0000000000000000";
};

function saveHeroStats(game, callback) {
	(function save(slot) {
		if (slot >= game.slots.length || slot >= 9) return callback(null);
		if (game.slots[slot].state != 'EMPTY' && game.slots[slot].hero != 0) {
			HeroStat.findOne({ hero: game.slots[slot].hero }, function(err, stat) {
				if (err) return callback(err);
				if (!stat) stat = new HeroStat({
					hero: game.slots[slot].hero
				});
				stat.kills += game.slots[slot].kills;
				stat.deaths += game.slots[slot].deaths;
				stat.assists += game.slots[slot].assists;
				stat.points += game.slots[slot].points;
				stat.gpm += game.slots[slot].gpm;
				if (game.slots[slot].win) stat.wins += 1;
				stat.games += 1;
				stat.chanceWin = Calculator.AgrestiCoullLower(stat.games, stat.wins);
				stat.score = Calculator.calculateScore(stat);
				stat.save(function(err) {
					if (err) return res.status(500).json(err);
					save(slot + 1);
				}); 
			});
		} else {
			save(slot + 1);
		}
	})(0);
}

function savePlayerGames(game, callback) {
	(function save(slot) {
		if (slot >= game.slots.length || slot >= 9) return callback(null);
		if (game.slots[slot].state != 'EMPTY') {
			Stat.findOne({ username: game.slots[slot].username.toLowerCase() }, function(err, stat) {
				if (err) return callback(err);
				if (game.slots[slot].kills == 0 && game.slots[slot].deaths == 0 && game.slots[slot].assists == 0) {
					save(slot + 1);
				} else {
					if (!stat) stat = new Stat({
						username: game.slots[slot].username.toLowerCase(),
						games: 0
					});
					stat.games += 1; 
					stat.save(function(err) {
						if (err) return callback(err);
						save(slot + 1);
					});
				}
			});
		} else {
			save(slot + 1);
		}
	})(0);
}

function savePlayerStats(game, callback) {
	(function save(slot) {
		if (slot >= game.slots.length || slot >= 9) return callback(null);
		if (game.slots[slot].state != 'EMPTY') {
			Stat.findOne({ username: game.slots[slot].username.toLowerCase() }, function(err, stat) {
				if (err) return callback(err);
				if (game.slots[slot].kills == 0 && game.slots[slot].deaths == 0 && game.slots[slot].assists == 0) {
					save(slot + 1);
				} else {
					if (!stat) stat = new Stat({
						username: game.slots[slot].username.toLowerCase(),
						kills: game.slots[slot].kills,
						deaths: game.slots[slot].deaths,
						assists: game.slots[slot].assists,
						points: game.slots[slot].points,
						gpm: game.slots[slot].gpm,
						gamesRanked: 0
					});
					var alpha = Math.min(1 - 1.0 / (stat.gamesRanked + 1), 0.95);
					var beta = 1 - alpha; 
					stat.kills = stat.kills * alpha + game.slots[slot].kills * beta
					stat.deaths = stat.deaths * alpha + game.slots[slot].deaths * beta;
					stat.assists = stat.assists * alpha + game.slots[slot].assists * beta;
					stat.points = stat.points * alpha + game.slots[slot].points * beta;
					stat.gpm = stat.gpm * alpha + game.slots[slot].gpm * beta;
					if (game.slots[slot].win) stat.wins += 1;
					stat.gamesRanked += 1; 
					stat.chanceWin = Calculator.AgrestiCoullLower(stat.gamesRanked, stat.wins);
					stat.score = Calculator.calculateScore(stat);
					stat.save(function(err) {
						if (err) return callback(err);
						save(slot + 1);
					});
				}
			});
		} else {
			save(slot + 1);
		}
	})(0);
}

function getPlayerPoints(game, callback) {
	var points = { };
	(function get(slot) {
		if (slot >= game.slots.length || slot >= 9) return callback(null, points);
		if (game.slots[slot].state != 'EMPTY') {
			getPlayerAlias(game.slots[slot].username.toLowerCase(), function(err, alias) {
				var username = err || !alias ? game.slots[slot].username.toLowerCase() : alias;
				StatCalculator.getPlayerStats(username, function(err, stat) {
					if (!err) {
						points[stat._id] = stat.points;
					}
					get(slot + 1);
				});
			});
		} else {
			get(slot + 1);
		}
	})(0);
}

router.post('/', function(req, res) { 
	var game = new Game({
		id: mongoose.Types.ObjectId().toString(),
		createdAt: new Date(),
		gamename: 'Naruto Ninpou Reforged',
		map: 'Unknown',
		owner: 'None',
		duration: '00:00:00',
		slots: [],
		players: 0,
		progress: false,
		recorded: true,
		recordable: true,
		ranked: false
	});
	var body = req.body.contents.replace(/\n/g, '').replace(/\r/g, '').trim();
	if (body.length < 11) return res.status(400).json({ error: 'Invalid code. Reason: 0' });
	console.log(body);
	Code.findOne({ code: body }, function(err, code) {
		if (err) return res.status(500).json({ error: err });
		else if (code) return res.status(400).json({ error: 'This game was already recorded.' });
		Decoder.decodeGame(body, game, function(err, game) {
			if (err) return res.status(400).json({ error: err });
			else if (game.players != 9) return res.status(400).json({ error: 'You can only record games with 9 players.' });
			else if (parseInt(game.duration.split(':')[0]) == 0 && parseInt(game.duration.split(':')[1]) < 40) return res.status(400).json({ error: 'You can only record games past 40 minutes.' });
			else if (parseInt(game.duration.split(':')[0]) > 0) return res.status(400).json({ error: 'You can only record games between 40 and 60 minutes.' });
			var code = new Code({ code: body });
			code.save(function(err) {
				if (err) return res.status(500).json({ error: err });
				game.save(function(err) {
					if (err) return res.status(500).json({ error: err });
					savePlayerGames(game, function(err) {
						if (err) return res.status(500).json({ error: err });
						saveHeroStats(game, function(err) {
							if (err) return res.status(500).json({ error: err });
							return res.status(200).json(game);
						});
					});
				});
			});
		});
	});
});

router.post('/ranked/:game_id', function(req, res) {
	Game.findOne({ id: req.params.game_id }, function(err, game) {
		if (err) return res.status(500).json({ error: err });
		else if (!game) return res.status(404).json({ error: 'Game not found.' });
		else if (game.ranked) return res.status(400).json({ error: 'This game is already ranked.' });
		game.ranked = true;
		game.save(function(err) {
			if (err) return res.status(500).json({ error: err });
			getPlayerPoints(game, function(err, oldPoints) {
				if (err) return res.status(500).json({ error: err });
				savePlayerStats(game, function(err) {
					if (err) return res.status(500).json({ error: err });
					getPlayerPoints(game, function(err, newPoints) {
						if (err) return res.status(500).json({ error: err });
						var changes = [];
						for (var username in oldPoints) {
							changes.push({ alias: username, oldPoints: oldPoints[username], newPoints: newPoints[username] });
						}
						return res.status(200).json({ changes: changes });
					});
				});
			});
		});
	});
});

function getHeroes(callback) {
	Hero.find({ }, function(err, heroesObj) {
		if (err) return callback(err);
		var heroes = { };
		for (var i = 0; i < heroesObj.length; i++) {
			heroes[heroesObj[i].id] = heroesObj[i].name;
		}
		callback(null, heroes);
	});
}

function getPlayerSlotInGame(usernames, game) {
	for (var i = 0; i < game.slots.length; i++) {
		for (var j = 0; j < usernames.length; j++) {
			if (game.slots[i].username != null && game.slots[i].username.match(usernames[j])) {
				return i;
			}
		}
	}
	return -1;
}

router.get('/players/:username', function(req, res) {
	var timePeriod = moment().subtract(6, 'month').toDate();
	getHeroes(function(err, heroes) {
		if (err) return res.status(400).json({ error: err });
		var heroId = null;
		if (req.query.hero) {
			for (var id in heroes) {
				if (heroes[id].toLowerCase() == req.query.hero.toLowerCase()) {
					heroId = id;
					break;
				}
			}
		}
		StatCalculator.getPlayerStats(req.params.username, function(err, allStat) {
			if (err) return res.status(400).json({ error: err });
			StatCalculator.getAllPlayersRanking(function(err, stats) {
				if (err) return res.status(400).json({ error: err }); 
				allStat = StatCalculator.getRankingPositions(stats, allStat); 
				var query = { 'slots.username': { $in: allStat.usernames }, 'recorded': true, 'createdAt': { $gt: timePeriod } };
				if (heroId) {
					query['slots'] = { '$elemMatch': { username: { $in: allStat.usernames }, hero: heroId } };
				} else {
					query['slots.username'] = { $in: allStat.usernames };
				}
				Game.find(query).sort('-_id').exec(function(err, games) {
					if (err) return res.status(500).json({ error: err }); 
					var newGamesRanked = [];
					var newGamesNotRanked = [];
					for (var i = 0; i < games.length; i++) {
						var slot = getPlayerSlotInGame(allStat.usernames, games[i]);
						if (slot != -1 && games[i].slots[slot].hero != 0 && games[i].slots[slot].kills != null) {
							var game = {
								id: games[i].id,
								kills: games[i].slots[slot].kills,
								deaths: games[i].slots[slot].deaths,
								assists: games[i].slots[slot].assists,
								points: games[i].slots[slot].points,
								hero: heroes[games[i].slots[slot].hero],
								date: moment(dateFromObjectId(games[i]._id.toString())).fromNow(),
								win: games[i].slots[slot].win,
								ranked: games[i].ranked
							};
							if (games[i].ranked) {
								newGamesRanked.push(game);
							} else {
								newGamesNotRanked.push(game);
							}
						}
					}
					var lastGamesRanked = newGamesRanked.slice(0, 5);
					var lastGamesNotRanked = newGamesNotRanked.slice(0, 5);
					StatCalculator.getPlayerHeroesRanking(req.params.username.toLowerCase(), allStat.usernames, heroes, timePeriod, function(err, bestHeroes, worstHeroes, allHeroes) {
						if (err) return res.status(500).json({ error: err }); 
						newGamesRanked.sort(function(a, b) {
							return b.points - a.points;
						});
						newGamesNotRanked.sort(function(a, b) {
							return b.points - a.points;
						});
						var bestGameRanked = newGamesRanked.length > 0 ? newGamesRanked[0] : null;
						var worstGameRanked = newGamesRanked.length > 0 ? newGamesRanked[newGamesRanked.length - 1] : null;
						var bestGameNotRanked = newGamesNotRanked.length > 0 ? newGamesNotRanked[0] : null;
						var worstGameNotRanked = newGamesNotRanked.length > 0 ? newGamesNotRanked[newGamesNotRanked.length - 1] : null;
						if (heroId) {
							for (var i = 0; i < allHeroes.length; i++) {
								if (allHeroes[i]._id == heroId) {
									return res.json({ 
										'stat': allStat, 
										'ranked': {
											'bestGame': bestGameRanked, 
											'worstGame': worstGameRanked, 
											'numGames': newGamesRanked.length, 
											'lastGames': lastGamesRanked
										},
										'notRanked': {
											'bestGame': bestGameNotRanked, 
											'worstGame': worstGameNotRanked, 
											'numGames': newGamesNotRanked.length, 
											'lastGames': lastGamesNotRanked
										},
										'hero': allHeroes[i], 
										'heroRanking': i, 
										'numHeroes': allHeroes.length
									});
								}
							}
						} else {
							allHeroes.sort(function(a, b) {
								return b.games - a.games;
							});
							return res.json({ 
								'stat': allStat, 
								'ranked': {
									'bestGame': bestGameRanked, 
									'worstGame': worstGameRanked, 
									'numGames': newGamesRanked.length, 
									'lastGames': lastGamesRanked
								},
								'notRanked': {
									'bestGame': bestGameNotRanked, 
									'worstGame': worstGameNotRanked, 
									'numGames': newGamesNotRanked.length, 
									'lastGames': lastGamesNotRanked
								},
								'bestHeroes': bestHeroes, 
								'worstHeroes': worstHeroes, 
								'numHeroes': allHeroes.length, 
								'mostPlayed': allHeroes.slice(0, 5)
							});
						}
					});
				});
			});
		});
	});
});

router.delete('/players/:username', function(req, res) {
	var username = new RegExp(['^', StatCalculator.escapeRegExp(req.params.username.toLowerCase()), '$'].join(''), 'i'); 
	Stat.remove({ username: username }, function(err) {
		if (err) return res.status(500).json({ error: err });
		return res.status(200).send();
	});
});

router.post('/players/:username/merge/:another_username', function(req, res) {
	var username = new RegExp(['^', StatCalculator.escapeRegExp(req.params.username.toLowerCase()), '$'].join(''), 'i'); 
	Stat.findOne({ username: username }, function(err, sourceAlias) {
		if (err) return res.status(500).json({ error: err });
		else if (!sourceAlias) return res.status(400).json({ error: 'Old alias not found.' });
		var anotherUsername = new RegExp(['^', StatCalculator.escapeRegExp(req.params.another_username.toLowerCase()), '$'].join(''), 'i'); 
		Stat.findOne({ username: anotherUsername }, function(err, destAlias) {
			if (err) return res.status(500).json({ error: err });
			else if (!destAlias) return res.status(400).json({ error: 'New alias not found.' });
			destAlias.games += sourceAlias.games;
			destAlias.gamesRanked += sourceAlias.gamesRanked;
			destAlias.wins += sourceAlias.wins;
			var wa = destAlias.gamesRanked / (destAlias.gamesRanked + sourceAlias.gamesRanked);
			var wb = sourceAlias.gamesRanked / (destAlias.gamesRanked + sourceAlias.gamesRanked);
			destAlias.gpm = destAlias.gpm * wa + sourceAlias.gpm * wb;
			destAlias.assists = destAlias.assists * wa + sourceAlias.assists * wb;
			destAlias.deaths = destAlias.deaths * wa + sourceAlias.deaths * wb;
			destAlias.kills = destAlias.kills * wa + sourceAlias.kills * wb;
			destAlias.save(function(err) {
				if (err) return res.status(500).json({ error: err });
				sourceAlias.remove(function(err) {
					if (err) return res.status(500).json({ error: err });
					return res.status(200).send();
				});
			}); 
		});
	});
});

router.post('/players/:username/rerank', function(req, res) {
	StatCalculator.getPlayerStats(req.params.username, function(err, allStat) {
		if (err) return res.status(400).json({ error: err });
		var query = { 'slots.username': { $in: allStat.usernames }, 'recorded': true, 'ranked': true };
		Game.find(query).sort('_id').exec(function(err, games) {
			if (err) return res.status(500).json({ error: err }); 
			if (games.length > 0) {
				var i = 0;
				var stat;
				for (; i < games.length; i++) {
					var game = games[i];
					var slot = getPlayerSlotInGame(allStat.usernames, games[i]);
					if (slot != -1 && game.slots[slot].hero != 0 && game.slots[slot].kills != null) {
						Stat.find({ username: { $in: allStat.usernames } }).sort('-gamesRanked').limit(1).exec(function(err, stat) {
							stat = stat[0];
							var game = games[i];
							var slot = getPlayerSlotInGame(allStat.usernames, games[i]);
							stat.kills = game.slots[slot].kills;
							stat.deaths = game.slots[slot].deaths;
							stat.assists = game.slots[slot].assists;
							stat.points = game.slots[slot].points;
							stat.gpm = game.slots[slot].gpm;
							stat.count = 0;
							stat.gamesRanked = 0;
							stat.wins = 0;
							for (; i < games.length; i++) {
								var game = games[i];
								var alpha = Math.min(1 - 1.0 / (stat.gamesRanked + 1), 0.95);
								var beta = 1 - alpha; 
								var slot = getPlayerSlotInGame(allStat.usernames, games[i]);
								stat.kills = stat.kills * alpha + game.slots[slot].kills * beta
								stat.deaths = stat.deaths * alpha + game.slots[slot].deaths * beta;
								stat.assists = stat.assists * alpha + game.slots[slot].assists * beta;
								stat.points = stat.points * alpha + game.slots[slot].points * beta;
								stat.gpm = stat.gpm * alpha + game.slots[slot].gpm * beta;
								if (game.slots[slot].win) stat.wins += 1;
								stat.gamesRanked += 1; 
								stat.chanceWin = Calculator.AgrestiCoullLower(stat.gamesRanked, stat.wins);
								stat.score = Calculator.calculateScore(stat);
							}
							stat.save(function(err) {
								if (err) return res.status(500).json({ error: err }); 
								return res.status(200).send();
							});
						});
						break;
					}
				}
			} else {
				res.status(400).json({ error: 'This player has no ranked games.' });
			}
		});
	});
});

router.get('/heroes/:map/:hero_id', function(req, res) {
	HeroStat.findOne({ hero: req.params.hero_id, map: req.params.map }, function(err, stat) {
		if (err) return res.status(500).json(err);
		else if (!stat) return res.status(400).json({ error: 'Hero not found.' });
		stat.chanceWin = Calculator.AgrestiCoullLower(stat.games, stat.wins);
		stat.score = Calculator.calculateScore(stat);
		return res.json(stat);
	});
});

router.use('/ranking', function(req, res, next) {
	var attribute = req.query.sort || 'score';
	if (attribute != 'kills' && attribute != 'deaths' && attribute != 'assists' && attribute != 'gpm' && attribute != 'wins' && attribute != 'games' && attribute != 'points' && attribute != 'chance') {
		attribute = 'score'; 
	}   
	var sortOrder = req.query.order || 'asc';
	if (sortOrder != 'asc' && sortOrder != 'desc') {
		sortOrder = 'asc';  
	}  
	req.attribute = attribute;
	req.sortOrder = sortOrder;
	next();
});

router.get('/ranking', function(req, res) {  
	var minNumGames = 10;
	if (req.query.sort == 'games') {
		minNumGames = -1;
	}
	StatCalculator.getAllPlayersRanking(function(err, stats) {
		if (err) return res.status(400).json({ error: err });
		stats.sort(function(a, b) { 
			if (req.sortOrder == 'desc') {
				return b.ranking[req.attribute] - a.ranking[req.attribute];
			} else {
				return a.ranking[req.attribute] - b.ranking[req.attribute];
			}
		});  
		return res.json({ 'ranking': stats.slice(0, 10), 'index': 0, 'minIndex': 0 });
	}, minNumGames);  
});
 
router.get('/ranking/:username', function(req, res) { 
	StatCalculator.getPlayerStats(req.params.username, function(err, allStat) {
		if (err) return res.status(400).json({ error: err });
		StatCalculator.getAllPlayersRanking(function(err, stats) {
			if (err) return res.status(400).json({ error: err });
			allStat = StatCalculator.getRankingPositions(stats, allStat); 
			stats.sort(function(a, b) {
				if (req.sortOrder == 'desc') {
					return b.ranking[req.attribute] - a.ranking[req.attribute]; 
				} else {
					return a.ranking[req.attribute] - b.ranking[req.attribute]; 
				} 
			}); 
			var ranking = 0;
			for (var i = 0; i < stats.length; i++) {
				++ranking;
				if (req.sortOrder != 'desc') {
					if (stats[i].ranking[req.attribute] >= allStat.ranking[req.attribute]) {
						break;
					} 
				} else {  
					if (stats[i].ranking[req.attribute] <= allStat.ranking[req.attribute]) {
						break;
					}
				} 
			} 
			  
			var minIndex = Math.max(0, ranking - 5); 
			var newRanking = stats.splice(minIndex, 10); 
			return res.json({ 'ranking': newRanking, 'index': ranking, 'minIndex': minIndex });
		}, req.query.village); 
	}); 
});

module.exports = router;
