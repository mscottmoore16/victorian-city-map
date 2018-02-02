import { generate } from './mapgen/mapgen'
import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as http from 'http';
import * as socketIo from 'socket.io';
import GameState from './common/gamestate';
import { MapJson } from './common/map';

const app = express();
const httpServer = new http.Server(app);
const io = socketIo(httpServer);

app.use(express.static('public'));
app.use(bodyParser.json())

let roles = ['rebel', 'authority', 'observer'];
let map: MapJson = null;
let gameState: GameState = null;

io.on('connection', socket => {
  socket.emit('roles', roles);
  if (gameState) {
    socket.emit('start-game');
  }

  function assignRole(requestedRole) {
    role = requestedRole;
    if (role !== 'observer') {
      roles = roles.filter(r => r !== role);
    }
    io.emit('roles', roles);
  }

  socket.on('start-game', ({seed, role}) => {
    map = generate({
      width: 3200,
      height: 1800,
      seed: parseFloat(seed || Math.random() * 1000000)
    });
    gameState = {
      turns: {
        number: 1,
        rebel: null,
        authority: null
      },
      rebelControlled: [],
      rebelPosition: 0,
      uncovered: [],
      patrols: [],
      victor: null,
      log: []
    };
    const urbanDistricts = map.districts.filter(d => d.type === 'urban');
    const rebelStart = urbanDistricts[Math.floor(Math.random() * urbanDistricts.length)];
    gameState.rebelControlled.push(rebelStart.id);
    gameState.rebelPosition = rebelStart.id;

    io.emit('start-game');
    assignRole(role);
    socket.emit('join-game', {role, map});
    socket.emit('game-state', gameState);
  });

  let role = null;
  socket.on('join-game', requestedRole => {
    if (roles.includes(requestedRole)) {
      assignRole(requestedRole);
      socket.emit('join-game', {role, map});
      socket.emit('game-state', gameState);
    }
  });

  socket.on('disconnect', () => {
    if (role && role !== 'observer') {
      roles.push(role);
    }
  })

  socket.on('submit-turn', (role, turn) => {
    gameState = submitTurn(gameState, role, turn);
    if (gameState.turns.rebel && gameState.turns.authority) {
      gameState = processTurn(gameState);
    }
    io.emit('game-state', gameState);

    if (gameState.victor) {
      roles = ['rebel', 'authority', 'observer'];
      map = null;
      gameState = null;
    }
  });
});

function submitTurn(state: GameState, role: string, turn: any): GameState {
  if (role === 'rebel') {
    state.turns.rebel = turn;
  }
  if (role === 'authority') {
    state.turns.authority = turn;
  }
  return state;
}

function processTurn(state: GameState): GameState {

  let rebelDistrict = map.districts[state.turns.rebel.district];
  let authorityDistrict = map.districts[state.turns.authority.district];

  state.rebelPosition = rebelDistrict.id;

  if (!state.rebelControlled.includes(rebelDistrict.id)) {
    state.rebelControlled.push(rebelDistrict.id);
    if (state.patrols.includes(rebelDistrict.id)) {
      state.patrols = state.patrols.filter(id => id !== rebelDistrict.id);
      state.uncovered.push(rebelDistrict.id);
      state.log.push(`Police patrols driven out of ${rebelDistrict.name}, rebel leadership seen leading attack`);
    }
  }
  if (rebelDistrict === authorityDistrict) {
    state.victor = 'authority';
    state.log.push(`Rebellion leadership captured during raid in ${authorityDistrict.name}`);
  } else  if (state.rebelControlled.length === 15) {
    state.victor = 'rebel';
    state.log.push(`The Old Regime has been toppled, long live the Revolution!`);
  } else if (state.uncovered.includes(authorityDistrict.id)) {
    state.uncovered = state.uncovered.filter(id => id !== authorityDistrict.id);
    state.rebelControlled = state.rebelControlled.filter(id => id !== authorityDistrict.id);
    state.patrols.push(authorityDistrict.id);
    state.log.push(`Raid in ${authorityDistrict.name}, rebels on the retreat!`);
  } else if (state.rebelControlled.includes(state.turns.authority.district)) {
    state.uncovered.push(authorityDistrict.id);
    state.log.push(`Police uncover rebel menace in ${authorityDistrict.name}`)
  } else {
    state.patrols.push(authorityDistrict.id);
    state.log.push(`New patrols established in ${authorityDistrict.name}, no insurgents found`);
  }


  state.turns.number++;
  state.turns.rebel = null;
  state.turns.authority = null;

  return state;
}

httpServer.listen(3000);
