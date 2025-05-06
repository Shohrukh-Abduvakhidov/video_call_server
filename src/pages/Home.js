import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function Home() {
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const createRoom = async () => {
    setLoading(true);
    const res = await fetch('http://localhost:3001/create-room');
    const data = await res.json();
    navigate(`/room/${data.roomId}`);
  };

  const joinRoom = (e) => {
    e.preventDefault();
    if (roomId.trim()) {
      navigate(`/room/${roomId}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 80 }}>
      <h2>Групповой видеозвонок</h2>
      <button onClick={createRoom} disabled={loading} style={{ marginBottom: 20 }}>
        {loading ? 'Создание...' : 'Создать комнату'}
      </button>
      <form onSubmit={joinRoom} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="ID комнаты"
          value={roomId}
          onChange={e => setRoomId(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <button type="submit">Войти в комнату</button>
      </form>
    </div>
  );
}

export default Home;
