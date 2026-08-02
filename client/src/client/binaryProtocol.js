// Binary wire format for the hot-path messages (state broadcast, input).
// Must stay byte-for-byte in sync with server/protocol/binary.go — see
// that file's doc comment for the full layout tables.

export const BIN_MSG_STATE = 1;
export const BIN_MSG_INPUT = 2;

const NAME_BYTES = 12;
const STATE_HEADER_BYTES = 10;
const PLAYER_RECORD_BYTES = 33;
const ORB_RECORD_BYTES = 15;
const KILL_RECORD_BYTES = 28;
const FLAG_ALIVE = 1;
const INPUT_FLAG_BOOST = 1;
const INPUT_FLAG_SHOOT = 2;

function decodeName(view, offset) {
  let len = NAME_BYTES;
  while (len > 0 && view.getUint8(offset + len - 1) === 0) len--;
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
  return new TextDecoder().decode(bytes);
}

export function decodeStateBinary(view) {
  const tick = view.getUint32(1, true);
  const playerCount = view.getUint16(5, true);
  const orbCount = view.getUint16(7, true);
  const killCount = view.getUint8(9);

  let off = STATE_HEADER_BYTES;
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const idNum = view.getUint16(off, true);
    const name = decodeName(view, off + 2);
    const x = view.getFloat32(off + 14, true);
    const y = view.getFloat32(off + 18, true);
    const stamina = view.getFloat32(off + 22, true);
    const score = view.getFloat32(off + 26, true);
    const flags = view.getUint8(off + 30);
    const respawnInMs = view.getUint16(off + 31, true);
    players.push({
      id: "p" + idNum,
      name,
      x,
      y,
      stamina,
      score,
      alive: (flags & FLAG_ALIVE) !== 0,
      respawnInMs
    });
    off += PLAYER_RECORD_BYTES;
  }

  const orbs = [];
  for (let i = 0; i < orbCount; i++) {
    const ownerIdNum = view.getUint16(off, true);
    const x = view.getFloat32(off + 2, true);
    const y = view.getFloat32(off + 6, true);
    const size = view.getFloat32(off + 10, true);
    const mode = view.getUint8(off + 14);
    const ownerId = "p" + ownerIdNum;
    orbs.push({ id: ownerId + "_o", ownerId, x, y, size, mode });
    off += ORB_RECORD_BYTES;
  }

  const kills = [];
  for (let i = 0; i < killCount; i++) {
    const killerIdNum = view.getUint16(off, true);
    const killerName = decodeName(view, off + 2);
    const victimIdNum = view.getUint16(off + 14, true);
    const victimName = decodeName(view, off + 16);
    kills.push({
      killerId: "p" + killerIdNum,
      killerName,
      victimId: "p" + victimIdNum,
      victimName
    });
    off += KILL_RECORD_BYTES;
  }

  return { tick, players, orbs, kills };
}

export function encodeInputBinary(input) {
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  view.setUint8(0, BIN_MSG_INPUT);
  view.setFloat32(1, input.ax, true);
  view.setFloat32(5, input.ay, true);
  let flags = 0;
  if (input.boost) flags |= INPUT_FLAG_BOOST;
  if (input.shoot) flags |= INPUT_FLAG_SHOOT;
  view.setUint8(9, flags);
  return buf;
}
