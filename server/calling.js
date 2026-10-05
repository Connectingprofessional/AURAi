/* TrackMeNow WebRTC calling helpers.
 * Signaling uses the existing /ws WebSocket room server; media stays peer-to-peer.
 * No camera/microphone media is sent through this server. */
export const CALL_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
