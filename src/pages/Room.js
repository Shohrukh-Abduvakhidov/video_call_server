import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [peers, setPeers] = useState({});
  const [myId, setMyId] = useState(null);
  const [users, setUsers] = useState([]);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const socketRef = useRef();
  const peersRef = useRef({});
  const localVideoRef = useRef();
  const localStreamRef = useRef();

  const handleLeave = () => {
    if (socketRef.current) {
      socketRef.current.emit('leave-room');
      socketRef.current.disconnect();
    }
    Object.values(peersRef.current).forEach(peer => peer.close());
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    setPeers({});
    setUsers([]);
    navigate('/');
  };

  useEffect(() => {
    socketRef.current = io(SERVER_URL);

    socketRef.current.on('connect', () => {
      setMyId(socketRef.current.id);
      console.log('[client] socketRef.current.id:', socketRef.current.id);
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          localVideoRef.current.srcObject = stream;
          localStreamRef.current = stream;

          // userId всегда равен socketRef.current.id!
          socketRef.current.emit('join-room', { roomId, userId: socketRef.current.id });

          socketRef.current.on('all-users', (userIds) => {
            console.log('[all-users]', userIds);
            const validUserIds = userIds.filter(id => typeof id === 'string' && id);
            setUsers(validUserIds);
            validUserIds.forEach(userId => {
              if (userId !== socketRef.current.id && !peersRef.current[userId]) {
                console.log('[all-users] callUser для', userId);
                callUser(userId, stream);
              }
            });
          });

          socketRef.current.on('user-joined', (userId) => {
            console.log('[user-joined]', userId);
            if (!userId || typeof userId !== 'string') return;
            setUsers(prev => [...prev, userId]);
            if (userId !== socketRef.current.id && !peersRef.current[userId]) {
              console.log('[user-joined] callUser для', userId);
              callUser(userId, stream);
            }
          });

          socketRef.current.on('offer', async ({ from, offer }) => {
            if (!from || typeof from !== 'string') return;
            let peer = peersRef.current[from];
            if (!peer) {
              peer = createPeer(from, false, stream);
            }
            console.log('[offer] от', from, offer, 'peer.signalingState:', peer.signalingState);
            // Не отвечаем, если peer уже в stable (уже был answer)
            if (peer.signalingState !== 'stable') {
              try {
                await peer.setRemoteDescription(new RTCSessionDescription(offer));
              } catch (err) {
                console.warn('[offer] setRemoteDescription(offer) error:', err, 'peer.signalingState:', peer.signalingState);
              }
              // Создаём answer только если peer в состоянии have-remote-offer
              if (peer.signalingState === 'have-remote-offer') {
                const answer = await peer.createAnswer();
                try {
                  await peer.setLocalDescription(answer);
                } catch (err) {
                  console.warn('[offer] setLocalDescription(answer) error:', err, 'peer.signalingState:', peer.signalingState);
                }
                socketRef.current.emit('answer', { to: from, answer });
                console.log('[answer] setLocalDescription, signalingState:', peer.signalingState);
              } else {
                console.warn('[offer] Пропущен createAnswer, peer.signalingState:', peer.signalingState);
              }
            } else {
              console.warn('[offer] Пропущен setLocalDescription(answer), peer уже в stable');
            }
          });

          socketRef.current.on('answer', async ({ from, answer }) => {
            const peer = peersRef.current[from];
            if (!peer) return;
            console.log('[answer] от', from, answer, 'peer.signalingState:', peer.signalingState);
            // Только если peer в состоянии "have-local-offer" можно применять answer
            if (peer.signalingState === 'have-local-offer') {
              try {
                try {
                  await peer.setRemoteDescription(new RTCSessionDescription(answer));
                } catch (err) {
                  console.warn('[answer] setRemoteDescription error:', err, 'peer.signalingState:', peer.signalingState);
                }
              } catch (err) {
                console.warn('[answer] setRemoteDescription error:', err);
              }
            } else {
              console.warn('[answer] Пропущен setRemoteDescription(answer), peer.signalingState:', peer.signalingState);
            }
          });

          socketRef.current.on('ice-candidate', ({ from, candidate }) => {
            console.log('[ice-candidate] от', from, candidate);
            const peer = peersRef.current[from];
            if (peer && candidate) {
              peer.addIceCandidate(new RTCIceCandidate(candidate));
            }
          });

          socketRef.current.on('user-left', (userId) => {
            console.log('[user-left]', userId);
            if (peersRef.current[userId]) {
              peersRef.current[userId].close();
              delete peersRef.current[userId];
              setPeers(prev => {
                const copy = { ...prev };
                delete copy[userId];
                console.log('[user-left] peers:', copy);
                return copy;
              });
            }
            setUsers(prev => prev.filter(id => id !== userId));
          });
        });
    });

    return () => {
      socketRef.current.disconnect();
      Object.values(peersRef.current).forEach(peer => peer.close());
    };
  }, [roomId]);

  function createPeer(userId, isInitiator, stream) {
    if (peersRef.current[userId]) {
      peersRef.current[userId].close();
      delete peersRef.current[userId];
    }
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current[userId] = peer;

    // Только инициатор добавляет свои треки
    if (isInitiator) {
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      videoTracks.forEach(track => peer.addTrack(track, stream));
      audioTracks.forEach(track => peer.addTrack(track, stream));
    }

    peer.onicecandidate = e => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', { to: userId, candidate: e.candidate });
      }
    };

    peer.ontrack = e => {
      console.log('[ontrack] userId:', userId, 'stream:', e.streams[0]);
      setPeers(prev => {
        const updated = { ...prev, [userId]: e.streams[0] };
        console.log('[setPeers] peers:', updated);
        return updated;
      });
    };



    if (isInitiator) {
      peer.onnegotiationneeded = async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socketRef.current.emit('offer', { to: userId, offer });
        } catch (err) {
          console.error('Negotiation error:', err);
        }
      };
    }

    return peer;
  }

  async function callUser(userId, stream) {
    if (userId === socketRef.current.id) return; // не звонить самому себе!
    console.log('[callUser] вызывается для', userId);
    const existingPeer = peersRef.current[userId];
    if (existingPeer) {
      existingPeer.ontrack = null;
      existingPeer.onicecandidate = null;
      existingPeer.onnegotiationneeded = null;
      existingPeer.close();
      delete peersRef.current[userId];
      await new Promise(res => setTimeout(res, 100));
    }

    const peer = createPeer(userId, true, stream);
    if (!peer) return;

    try {
      await new Promise(res => setTimeout(res, 50));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current.emit('offer', { to: userId, offer });
      console.log('[callUser] отправлен offer для', userId);
    } catch (err) {
      console.error('[callUser] offer error:', err);
    }
  }

  // Логируем всё состояние для отладки
  console.log('users:', users, 'peers:', peers);
  users.forEach(userId => {
    console.log('[render] userId:', userId, 'peers[userId]:', peers[userId]);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 30 }}>
      <h3>Комната: {roomId}</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginTop: 20 }}>
        <div>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Вы</div>
          <video ref={localVideoRef} autoPlay muted playsInline style={{ width: 240, height: 180, background: '#222' }} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => {
              const stream = localStreamRef.current;
              if (stream) {
                stream.getVideoTracks().forEach(track => {
                  track.enabled = !isCameraOn;
                });
                setIsCameraOn(v => !v);
              }
            }}>
              {isCameraOn ? 'Выключить камеру' : 'Включить камеру'}
            </button>
            <button onClick={() => {
              const stream = localStreamRef.current;
              if (stream) {
                stream.getAudioTracks().forEach(track => {
                  track.enabled = !isMicOn;
                });
                setIsMicOn(v => !v);
              }
            }}>
              {isMicOn ? 'Выключить микрофон' : 'Включить микрофон'}
            </button>
            <button onClick={handleLeave} style={{ background: '#e74c3c', color: 'white' }}>
              Выйти из звонка
            </button>
          </div>
        </div>
        {users.filter(userId => typeof userId === 'string' && userId).map(userId => (
          <div key={userId}>
            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{userId.slice(-4)}</div>
            {peers[userId] ? (
              <video
                autoPlay
                playsInline
                ref={video => {
                  if (video && peers[userId]) {
                    const tracks = peers[userId].getTracks ? peers[userId].getTracks() : [];
                    console.log('[render] video ref для', userId, 'peers[userId]:', peers[userId], 'tracks:', tracks);
                    video.srcObject = peers[userId];
                  }
                }}
                style={{ width: 240, height: 180, background: '#222' }}
              />
            ) : (
              <div style={{ width: 240, height: 180, background: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                Ожидание видео...
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}



export default Room;