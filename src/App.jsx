import { useState, useRef, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

function App() {
  const [loaded, setLoaded] = useState(false);
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);

  const load = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      setLogs(prev => [...prev.slice(-5), message]);
      console.log(message);
    });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load ffmpeg', err);
      setLogs(prev => [...prev, 'Ошибка загрузки FFmpeg: ' + err.message]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(file));
      setLogs(prev => [...prev, `Файл выбран: ${file.name}`]);
    }
  }

  const onVideoLoad = () => {
    const dur = videoRef.current.duration;
    setDuration(dur);
    setEndTime(dur);
    setStartTime(0);
  }

  const trim = async () => {
    if (!videoFile) return;
    setProcessing(true);
    setLogs(prev => [...prev, 'Начало обработки...']);
    
    try {
      const ffmpeg = ffmpegRef.current;
      const inputName = 'input.mp4';
      const outputName = 'output.mp4';

      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      // Команда для обрезки
      // Используем -ss перед -i для быстрого поиска (но менее точно) или после -i для точности.
      // Здесь используем -ss до -i и -to после для баланса скорости.
      await ffmpeg.exec([
        '-ss', startTime.toFixed(2),
        '-i', inputName,
        '-to', (endTime - startTime).toFixed(2),
        '-c', 'copy',
        outputName
      ]);

      const data = await ffmpeg.readFile(outputName);
      const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `cut_${videoFile.name}`;
      a.click();
      
      setLogs(prev => [...prev, 'Успешно завершено!']);
    } catch (err) {
      setLogs(prev => [...prev, 'Ошибка при обработке: ' + err.message]);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="container">
      <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1>Bimba Video Cutter</h1>
        <p className="subtitle">Локальная обрезка видео без потери качества и серверов</p>
      </header>

      <main className="glass" style={{ padding: '2.5rem', maxWidth: '900px', margin: '0 auto' }}>
        {!videoFile ? (
          <label className="upload-zone">
            <div style={{ background: 'rgba(139, 92, 246, 0.1)', padding: '2rem', borderRadius: '50%', marginBottom: '1rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <span style={{ fontSize: '1.2rem', fontWeight: '500' }}>Перетащите видео или нажмите для выбора</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Поддерживаются MP4, MOV, MKV и др.</span>
            <input type="file" hidden accept="video/*" onChange={handleFileChange} />
          </label>
        ) : (
          <div className="editor-layout">
            <video 
              ref={videoRef}
              src={videoUrl} 
              className="video-preview" 
              controls 
              onLoadedMetadata={onVideoLoad}
              style={{ width: '100%', borderRadius: '12px' }}
            />
            
            <div className="controls-grid" style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
              <div className="control-group">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label>Начало</label>
                  <span style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{startTime.toFixed(2)}с</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max={duration} 
                  step="0.01" 
                  value={startTime}
                  onChange={(e) => setStartTime(Math.min(parseFloat(e.target.value), endTime - 0.1))}
                />
              </div>
              
              <div className="control-group">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label>Конец</label>
                  <span style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{endTime.toFixed(2)}с</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max={duration} 
                  step="0.01" 
                  value={endTime}
                  onChange={(e) => setEndTime(Math.max(parseFloat(e.target.value), startTime + 0.1))}
                />
              </div>
            </div>

            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
              <button 
                className="btn btn-primary" 
                onClick={trim} 
                disabled={!loaded || processing}
                style={{ minWidth: '220px' }}
              >
                {processing ? (
                  <>
                    <div className="pulse" style={{ marginRight: '10px' }}>●</div>
                    Обработка...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <line x1="9" y1="3" x2="9" y2="21"/>
                      <line x1="15" y1="3" x2="15" y2="21"/>
                      <line x1="3" y1="9" x2="21" y2="9"/>
                      <line x1="3" y1="15" x2="21" y2="15"/>
                    </svg>
                    Обрезать и скачать
                  </>
                )}
              </button>
              <button className="btn" onClick={() => setVideoFile(null)} disabled={processing} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }}>
                Другое видео
              </button>
            </div>
          </div>
        )}
        
        <div className="log-panel" style={{ marginTop: '3rem' }}>
          <div style={{ marginBottom: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-secondary)' }}>Консоль FFmpeg</span>
            <span className="status-badge" style={{ 
              background: loaded ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
              color: loaded ? '#10b981' : '#f59e0b',
              border: `1px solid ${loaded ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`
            }}>
              {loaded ? 'Система готова' : 'Инициализация...'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {logs.length === 0 && <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Ожидание действий...</div>}
            {logs.map((log, i) => (
              <div key={i} style={{ color: log.includes('Error') ? '#ef4444' : 'inherit' }}>
                <span style={{ color: 'var(--accent-color)', marginRight: '8px' }}>$</span>
                {log}
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        <p>&copy; 2024 Bimba Video Cutter. Все вычисления происходят на вашем устройстве.</p>
      </footer>
    </div>
  )
}

export default App
