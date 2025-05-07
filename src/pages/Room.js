import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const SERVER_URL = 'https://video-call-server-dxkq.onrender.com';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [peers, setPeers] = useState({}); // userId -> stream
  const [myId, setMyId] = useState(null);
  const [users, setUsers] = useState([]);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const socketRef = useRef();
  const peersRef = useRef({}); // userId -> RTCPeerConnection
  const localVideoRef = useRef();
  const localStreamRef = useRef();

  const handleLeave = () => {
    // Оповестить сервер
    if (socketRef.current) {
      socketRef.current.emit('leave-room');
      socketRef.current.disconnect();
    }
    // Остановить все peer соединения
    Object.values(peersRef.current).forEach(peer => peer.close());
    // Остановить локальный стрим
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    // Очистить состояние
    setPeers({});
    setUsers([]);
    // Перейти на главную
    navigate('/');
  };

  useEffect(() => {
    socketRef.current = io(SERVER_URL);
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        localVideoRef.current.srcObject = stream;
        localStreamRef.current = stream;

        socketRef.current.emit('join-room', roomId, socketRef.current.id);
        setMyId(socketRef.current.id);

        socketRef.current.on('all-users', (userIds) => {
          setUsers(userIds);
          userIds.forEach(userId => {
            callUser(userId, stream);
          });
        });

        socketRef.current.on('user-joined', (userId) => {
          setUsers(prev => [...prev, userId]);
        });

        socketRef.current.on('offer', async ({ from, offer }) => {
          const peer = createPeer(from, false, stream);
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socketRef.current.emit('answer', { to: from, answer });
        });

        socketRef.current.on('answer', async ({ from, answer }) => {
          const peer = peersRef.current[from];
          if (peer) {
            await peer.setRemoteDescription(new RTCSessionDescription(answer));
          }
        });

        socketRef.current.on('ice-candidate', ({ from, candidate }) => {
          const peer = peersRef.current[from];
          if (peer && candidate) {
            peer.addIceCandidate(new RTCIceCandidate(candidate));
          }
        });

        socketRef.current.on('user-left', (userId) => {
          if (peersRef.current[userId]) {
            peersRef.current[userId].close();
            delete peersRef.current[userId];
            setPeers(prev => {
              const copy = { ...prev };
              delete copy[userId];
              return copy;
            });
          }
          setUsers(prev => prev.filter(id => id !== userId));
        });
      });

    return () => {
      socketRef.current.disconnect();
      Object.values(peersRef.current).forEach(peer => peer.close());
    };
    // eslint-disable-next-line
  }, [roomId]);

  function createPeer(userId, isInitiator, stream) {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', { to: userId, candidate: e.candidate });
      }
    };
    peer.ontrack = (e) => {
      setPeers(prev => ({ ...prev, [userId]: e.streams[0] }));
    };

    if (isInitiator) {
      peer.onnegotiationneeded = async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socketRef.current.emit('offer', { to: userId, offer });
      };
    }
    peersRef.current[userId] = peer;
    return peer;
  }

  function callUser(userId, stream) {
    const peer = createPeer(userId, true, stream);
  }

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
        {users.map(userId => (
          peers[userId] ? (
            <div key={userId}>
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{userId.slice(-4)}</div>
              <video
                autoPlay
                playsInline
                ref={video => {
                  if (video && peers[userId]) video.srcObject = peers[userId];
                }}
                style={{ width: 240, height: 180, background: '#222' }}
              />
            </div>
          ) : null
        ))}
      </div>
    </div>
  );
}


export default Room;
