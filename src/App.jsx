import { useState, useRef, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

function App() {
  const [loaded, setLoaded] = useState(false);
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef(null);
  const originalFileHandleRef = useRef(null);
  const videoContainerRef = useRef(null);
  const watermarkImgRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  
  // Watermark states
  const [watermarkFile, setWatermarkFile] = useState(null);
  const [watermarkUrl, setWatermarkUrl] = useState('');
  const [watermarkPos, setWatermarkPos] = useState({ x: 10, y: 10 });
  const [watermarkOpacity, setWatermarkOpacity] = useState(1.0);
  const [watermarkScale, setWatermarkScale] = useState(30);
  const [isDraggingWatermark, setIsDraggingWatermark] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  const load = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
    const ffmpeg = ffmpegRef.current;
    
    ffmpeg.on('log', ({ message }) => {
      setLogs(prev => [...prev.slice(-50), message]);
      console.log(message);
    });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setLoaded(true);
      setLogs(prev => [...prev, 'FFmpeg загружен и готов к работе.']);
    } catch (err) {
      console.error('Failed to load ffmpeg', err);
      setLogs(prev => [...prev, 'Ошибка загрузки FFmpeg: ' + err.message]);
    }
  }

  useEffect(() => {
    load();

    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);

    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const processFile = (file, fileHandle) => {
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      originalFileHandleRef.current = fileHandle || null;
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(file));
      setLogs(prev => [...prev, `Файл выбран: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`]);
    } else if (file) {
      setLogs(prev => [...prev, `Ошибка: Пожалуйста, выберите видео файл.`]);
    }
  };

  // Выбор файла через File System Access API (запоминает папку)
  const openFilePicker = async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'Видео файлы',
            accept: { 'video/*': ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv'] }
          }]
        });
        const file = await handle.getFile();
        processFile(file, handle);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          setLogs(prev => [...prev, 'Ошибка открытия файла: ' + err.message]);
        }
      }
    } else {
      // Фоллбэк: старый input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = (e) => processFile(e.target.files[0], null);
      input.click();
    }
  };

  const processWatermark = (file) => {
    if (file && file.type.startsWith('image/')) {
      setWatermarkFile(file);
      if (watermarkUrl) URL.revokeObjectURL(watermarkUrl);
      setWatermarkUrl(URL.createObjectURL(file));
      setLogs(prev => [...prev, `Водяной знак выбран: ${file.name}`]);
    } else if (file) {
      setLogs(prev => [...prev, `Ошибка: Выберите картинку (PNG, JPG и т.д.).`]);
    }
  };

  const openWatermarkPicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => processWatermark(e.target.files[0]);
    input.click();
  };

  const handleFileChange = (e) => {
    processFile(e.target.files[0], null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // ВАЖНО: сохраняем файл ДО любого await, т.к. браузер очищает dataTransfer
      const file = e.dataTransfer.files[0];
      
      // Пытаемся получить file handle для запоминания папки
      let fileHandle = null;
      if (e.dataTransfer.items && e.dataTransfer.items[0]?.getAsFileSystemHandle) {
        try {
          fileHandle = await e.dataTransfer.items[0].getAsFileSystemHandle();
        } catch (_) { /* ignore */ }
      }
      processFile(file, fileHandle);
    }
  };

  // Watermark dragging logic
  const handleWatermarkMouseDown = (e) => {
    e.preventDefault();
    setIsDraggingWatermark(true);
  };

  const handleWatermarkMouseMove = (e) => {
    if (!isDraggingWatermark || !videoContainerRef.current) return;
    const rect = videoContainerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    
    setWatermarkPos({ x, y });
  };

  const handleWatermarkMouseUp = () => {
    setIsDraggingWatermark(false);
  };

  useEffect(() => {
    if (isDraggingWatermark) {
      window.addEventListener('mousemove', handleWatermarkMouseMove);
      window.addEventListener('mouseup', handleWatermarkMouseUp);
    } else {
      window.removeEventListener('mousemove', handleWatermarkMouseMove);
      window.removeEventListener('mouseup', handleWatermarkMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleWatermarkMouseMove);
      window.removeEventListener('mouseup', handleWatermarkMouseUp);
    };
  }, [isDraggingWatermark]);

  const onVideoLoad = () => {
    const dur = videoRef.current.duration;
    setDuration(dur);
    setEndTime(dur);
    setStartTime(0);
  }

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    // Зацикливаем: если вышли за пределы endTime, возвращаемся к startTime
    if (current >= endTime && endTime > 0) {
      videoRef.current.currentTime = startTime;
      videoRef.current.play().catch(e => console.log('Autoplay prevented', e));
    }
  };

  // Sanitize filename: remove non-ASCII, replace spaces
  const sanitizeFileName = (name) => {
    const base = name.replace(/\.[^/.]+$/, ''); // убираем расширение
    const clean = base.replace(/[^\w\d-_.]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return clean || 'video';
  };

  const trim = async () => {
    if (!videoFile) return;
    setProcessing(true);
    setLogs(prev => [...prev, '--- Начало обработки ---']);
    
    try {
      const ffmpeg = ffmpegRef.current;
      const inputName = 'input.mp4';
      const outputName = 'output.mp4';

      setLogs(prev => [...prev, `Чтение файла в память (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)...`]);
      const fileData = await fetchFile(videoFile);
      await ffmpeg.writeFile(inputName, fileData);

      setLogs(prev => [...prev, `Обрезка: ${startTime.toFixed(2)}с → ${endTime.toFixed(2)}с (скорость: ${playbackSpeed}x)...`]);

      const args = [
        '-i', inputName
      ];

      if (watermarkFile) {
        setLogs(prev => [...prev, `Подготовка водяного знака...`]);
        const wmExt = watermarkFile.name.split('.').pop() || 'png';
        const wmName = `watermark.${wmExt}`;
        const wmFileData = await fetchFile(watermarkFile);
        await ffmpeg.writeFile(wmName, wmFileData);
        args.push('-i', wmName);
      }

      args.push(
        '-ss', startTime.toFixed(2),
        '-to', endTime.toFixed(2),
        '-avoid_negative_ts', 'make_zero'
      );

      // Применяем фильтры в зависимости от наличия ватермарки
      if (watermarkFile) {
        let finalWmWidth = -1;
        if (watermarkImgRef.current && videoRef.current) {
           const actualVideoWidth = videoRef.current.videoWidth;
           const vidRect = videoRef.current.getBoundingClientRect();
           const wmRect = watermarkImgRef.current.getBoundingClientRect();
           const scaleW = wmRect.width / vidRect.width;
           finalWmWidth = Math.round(actualVideoWidth * scaleW);
           // Убеждаемся, что ширина четная (иногда FFmpeg требует этого для scale)
           if (finalWmWidth % 2 !== 0) finalWmWidth += 1;
        }

        let vFilter = `[1:v]scale=${finalWmWidth > 0 ? finalWmWidth : 'iw'}:-1,format=rgba,colorchannelmixer=aa=${watermarkOpacity.toFixed(2)}[wm];`;
        
        if (playbackSpeed !== 1.0) {
          vFilter += `[0:v]setpts=${(1 / playbackSpeed).toFixed(4)}*PTS[vspeed];`;
          vFilter += `[vspeed][wm]overlay=x=(main_w-overlay_w)*${(watermarkPos.x / 100).toFixed(4)}:y=(main_h-overlay_h)*${(watermarkPos.y / 100).toFixed(4)}[vout]`;
        } else {
          vFilter += `[0:v][wm]overlay=x=(main_w-overlay_w)*${(watermarkPos.x / 100).toFixed(4)}:y=(main_h-overlay_h)*${(watermarkPos.y / 100).toFixed(4)}[vout]`;
        }
        args.push('-filter_complex', vFilter);
        args.push('-map', '[vout]', '-map', '0:a?');
        
        if (playbackSpeed !== 1.0) {
          args.push('-filter:a', `atempo=${playbackSpeed.toFixed(2)}`);
        }
      } else {
        if (playbackSpeed !== 1.0) {
          args.push(
            '-vf', `setpts=${(1 / playbackSpeed).toFixed(4)}*PTS`,
            '-af', `atempo=${playbackSpeed.toFixed(2)}`
          );
        } else {
          args.push('-map', '0'); // Если без фильтров, переносим все потоки (субтитры и т.д.)
        }
      }
      
      args.push(outputName);

      // Полное перекодирование
      const ret = await ffmpeg.exec(args);
      
      if (ret !== 0) {
        throw new Error(`FFmpeg завершился с ошибкой (код ${ret}). Проверьте логи выше.`);
      }

      const data = await ffmpeg.readFile(outputName);
      
      if (!data || data.length === 0) {
        throw new Error('Получен пустой файл. Попробуйте изменить интервал обрезки.');
      }

      setLogs(prev => [...prev, `Результат: ${(data.length / 1024 / 1024).toFixed(2)} MB`]);

      // Создаём blob
      const blob = new Blob([data], { type: 'video/mp4' });
      const safeName = `cut_${sanitizeFileName(videoFile.name)}.mp4`;
      
      setLogs(prev => [...prev, `Сохранение файла...`]);
      await saveFileDirectly(blob, safeName);
    } catch (err) {
      console.error(err);
      setLogs(prev => [...prev, 'ОШИБКА: ' + err.message]);
    } finally {
      setProcessing(false);
    }
  }

  const saveFileDirectly = async (blob, fileName) => {
    if (window.showSaveFilePicker) {
      try {
        // Если есть handle исходного файла, открываем диалог в той же папке
        const opts = {
          suggestedName: fileName,
          types: [{
            description: 'MP4 Видео',
            accept: { 'video/mp4': ['.mp4'] }
          }]
        };
        if (originalFileHandleRef.current) {
          opts.startIn = originalFileHandleRef.current;
        }
        const handle = await window.showSaveFilePicker(opts);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setLogs(prev => [...prev, '✅ Файл успешно сохранён!']);
        return;
      } catch (err) {
        if (err.name === 'AbortError') {
          setLogs(prev => [...prev, 'Сохранение отменено.']);
          return;
        }
        console.warn('showSaveFilePicker failed', err);
      }
    }

    // Фоллбэк
    const reader = new FileReader();
    reader.onload = () => {
      const a = document.createElement('a');
      a.href = reader.result;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
      setLogs(prev => [...prev, '✅ Файл успешно сохранён!']);
    };
    reader.readAsDataURL(blob);
  }

  return (
    <div className="container">
      <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1>Bimba Video Cutter</h1>
        <p className="subtitle">Локальная обрезка видео без потери качества и серверов</p>
      </header>

      <main className="glass" style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        {!videoFile ? (
          <div 
            className="upload-zone"
            style={{ 
              borderColor: isDragging ? 'var(--accent-color)' : 'var(--border-color)',
              background: isDragging ? 'rgba(139, 92, 246, 0.1)' : 'transparent'
            }}
            onClick={openFilePicker}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div style={{ background: 'rgba(139, 92, 246, 0.1)', padding: '2rem', borderRadius: '50%', marginBottom: '1rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <span style={{ fontSize: '1.2rem', fontWeight: '500' }}>Перетащите видео или нажмите для выбора</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Поддерживаются MP4, MOV, MKV и др.</span>
          </div>
        ) : (
          <div className="editor-layout" style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Левая колонка: Видео */}
            <div 
              style={{ 
                flex: '1 1 60%',
                position: 'relative', 
                display: 'flex', 
                justifyContent: 'center'
              }}
            >
              <div 
                ref={videoContainerRef}
                style={{ 
                  position: 'relative', 
                  borderRadius: '16px', 
                  overflow: 'hidden', 
                  background: '#000',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                  display: 'inline-block'
                }}
              >
                <video 
                  ref={videoRef}
                  src={videoUrl} 
                  controls 
                  autoPlay
                  onLoadedMetadata={onVideoLoad}
                  onTimeUpdate={handleTimeUpdate}
                  style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }}
                />
                {watermarkUrl && (
                  <img 
                    ref={watermarkImgRef}
                    src={watermarkUrl} 
                    alt="Watermark" 

                  style={{
                    position: 'absolute',
                    left: `${watermarkPos.x}%`,
                    top: `${watermarkPos.y}%`,
                    transform: 'translate(-50%, -50%)',
                    opacity: watermarkOpacity,
                    width: `${watermarkScale}%`, 
                    height: 'auto',
                    cursor: isDraggingWatermark ? 'grabbing' : 'grab',
                    pointerEvents: 'auto',
                    zIndex: 10,
                    userSelect: 'none'
                  }}
                  onMouseDown={handleWatermarkMouseDown}
                  draggable="false"
                />
              )}
              </div>
            </div>
            
            {/* Правая колонка: Управление */}
            <div style={{ flex: '1 1 35%', display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: '320px' }}>
              <div className="controls-grid" style={{ background: 'rgba(0,0,0,0.2)', padding: '1.2rem', borderRadius: '16px', marginTop: 0 }}>
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
                  onChange={(e) => {
                    const val = Math.min(parseFloat(e.target.value), endTime - 0.1);
                    setStartTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
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
                  onChange={(e) => {
                    const val = Math.max(parseFloat(e.target.value), startTime + 0.1);
                    setEndTime(val);
                    // При изменении конца показываем кадр конца
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                />
              </div>
              
              <div className="control-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label>Скорость воспроизведения</label>
                  <span style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{playbackSpeed.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" 
                  max="10.0" 
                  step="0.1" 
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div className="controls-grid" style={{ background: 'rgba(0,0,0,0.2)', padding: '1.2rem', borderRadius: '16px', marginTop: 0 }}>
              <div className="control-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label>Водяной знак</label>
                  {watermarkFile && (
                    <span 
                      style={{ color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                      onClick={() => { setWatermarkFile(null); setWatermarkUrl(''); }}
                    >
                      Удалить
                    </span>
                  )}
                </div>
                <button className="btn" onClick={openWatermarkPicker} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', width: '100%' }}>
                  {watermarkFile ? 'Заменить картинку' : '+ Загрузить логотип'}
                </button>
              </div>

              {watermarkFile && (
                <>
                  <div className="control-group" style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <label>Прозрачность</label>
                      <span style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{Math.round(watermarkOpacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1.0" 
                      step="0.05" 
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="control-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <label>Размер</label>
                      <span style={{ color: 'var(--accent-color)', fontWeight: '700' }}>{watermarkScale}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="5" 
                      max="100" 
                      step="1" 
                      value={watermarkScale}
                      onChange={(e) => setWatermarkScale(parseInt(e.target.value, 10))}
                    />
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', textAlign: 'center' }}>
                      Перетаскивайте логотип прямо на видео
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
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
                    </svg>
                    Обрезать
                  </>
                )}
              </button>
              <button className="btn" onClick={() => { setVideoFile(null); }} disabled={processing} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }}>
                Другое видео
              </button>
            </div>

            <div className="log-panel" style={{ marginTop: 'auto' }}>
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

      </div>
    )}
  </main>

      <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        <p>&copy; 2024 Bimba Video Cutter. Все вычисления происходят на вашем устройстве.</p>
      </footer>
    </div>
  )
}

export default App
