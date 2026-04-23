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
  const [resultBlob, setResultBlob] = useState(null);
  const [resultFileName, setResultFileName] = useState('');

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
        '-y',
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
        
        // Формула: центр водяного знака = x% ширины видео (как в CSS с translate(-50%,-50%))
        // FFmpeg: overlay_x = main_w * (x/100) - overlay_w/2
        const oxExpr = `main_w*${(watermarkPos.x / 100).toFixed(4)}-overlay_w/2`;
        const oyExpr = `main_h*${(watermarkPos.y / 100).toFixed(4)}-overlay_h/2`;
        
        if (playbackSpeed !== 1.0) {
          vFilter += `[0:v]setpts=${(1 / playbackSpeed).toFixed(4)}*PTS[vspeed];`;
          vFilter += `[vspeed][wm]overlay=x=${oxExpr}:y=${oyExpr}[vout]`;
        } else {
          vFilter += `[0:v][wm]overlay=x=${oxExpr}:y=${oyExpr}[vout]`;
        }
        args.push('-filter_complex', vFilter);
        args.push('-map', '[vout]', '-map', '0:a?');
        
        if (playbackSpeed !== 1.0) {
          args.push('-af', `atempo=${playbackSpeed.toFixed(2)}`);
        }
      } else {
        if (playbackSpeed !== 1.0) {
          args.push(
            '-vf', `setpts=${(1 / playbackSpeed).toFixed(4)}*PTS`,
            '-af', `atempo=${playbackSpeed.toFixed(2)}`
          );
        } else {
          args.push('-c', 'copy');
        }
      }
      
      args.push(outputName);

      // Логируем команду для отладки
      setLogs(prev => [...prev, `FFmpeg команда: ffmpeg ${args.join(' ')}`]);
      
      const ret = await ffmpeg.exec(args);
      
      if (ret !== 0) {
        throw new Error(`FFmpeg завершился с ошибкой (код ${ret}). Проверьте логи выше.`);
      }

      let data;
      try {
        data = await ffmpeg.readFile(outputName);
      } catch (readErr) {
        throw new Error('Не удалось прочитать выходной файл. FFmpeg мог не создать его.');
      }
      
      if (!data || data.byteLength === 0) {
        throw new Error('Получен пустой файл. Попробуйте изменить интервал обрезки.');
      }

      const sizeInMB = (data.byteLength / 1024 / 1024).toFixed(2);
      setLogs(prev => [...prev, `✅ Обработка завершена! Размер: ${sizeInMB} MB`]);

      // Создаём blob — сохраняем в state, чтобы пользователь скачал по клику
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const safeName = `cut_${sanitizeFileName(videoFile.name)}.mp4`;
      
      setResultBlob(blob);
      setResultFileName(safeName);
      setLogs(prev => [...prev, '⬇️ Нажмите кнопку "Скачать" для сохранения файла.']);
      
      // Очищаем файлы из виртуальной FS FFmpeg
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch (_) { /* игнорируем ошибки очистки */ }
    } catch (err) {
      console.error('Trim error:', err);
      setLogs(prev => [...prev, 'ОШИБКА: ' + err.message]);
    } finally {
      setProcessing(false);
    }
  }

  // Сохранение по клику пользователя (свежий user gesture → showSaveFilePicker работает)
  const handleDownload = async () => {
    if (!resultBlob) return;
    
    if (window.showSaveFilePicker) {
      try {
        const opts = {
          suggestedName: resultFileName,
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
        await writable.write(resultBlob);
        await writable.close();
        setLogs(prev => [...prev, '✅ Файл успешно сохранён!']);
        setResultBlob(null);
        setResultFileName('');
        return;
      } catch (err) {
        if (err.name === 'AbortError') {
          setLogs(prev => [...prev, 'Сохранение отменено пользователем.']);
          return;
        }
        console.warn('showSaveFilePicker failed, using fallback', err);
      }
    }

    // Фоллбэк через URL.createObjectURL
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultFileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    setLogs(prev => [...prev, '✅ Файл скачан через браузер!']);
    setResultBlob(null);
    setResultFileName('');
  }

  const formatTime = (t) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.round((t % 1) * 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  };

  const speedPresets = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];
  const [logsExpanded, setLogsExpanded] = useState(false);
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : 'Готов к работе';

  return (
    <div className="app-container">
      {/* Header */}
      <div className="app-header">
        <h1>✂ Bimba Video Cutter</h1>
        <div className="header-status">
          <span className={`status-dot ${loaded ? 'ready' : 'loading'}`} />
          <span>{loaded ? 'FFmpeg готов' : 'Загрузка FFmpeg...'}</span>
          {processing && (
            <span className="processing-badge">
              <span style={{ animation: 'blink 1s infinite' }}>●</span> Обработка...
            </span>
          )}
        </div>
      </div>

      {/* Main Editor */}
      {!videoFile ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div 
            className="upload-zone"
            style={{ 
              borderColor: isDragging ? 'var(--accent-color)' : 'var(--border-color)',
              background: isDragging ? 'rgba(139, 92, 246, 0.08)' : 'transparent'
            }}
            onClick={openFilePicker}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div style={{ background: 'rgba(139, 92, 246, 0.1)', padding: '1.5rem', borderRadius: '50%' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <span style={{ fontSize: '1.1rem', fontWeight: '500' }}>Перетащите видео или нажмите для выбора</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>MP4, MOV, MKV, AVI, WebM</span>
          </div>
        </div>
      ) : (
        <div className="editor-body">
          {/* Video */}
          <div className="video-area">
            <div className="video-wrapper" ref={videoContainerRef}>
              <video 
                ref={videoRef}
                src={videoUrl} 
                controls 
                autoPlay
                onLoadedMetadata={onVideoLoad}
                onTimeUpdate={handleTimeUpdate}
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

          {/* Controls Panel */}
          <div className="controls-panel">
            <div className="controls-scroll">
              {/* ── Trim ── */}
              <div className="ctrl-section">
                <div className="ctrl-section-title">✂ Обрезка</div>
                
                <div className="ctrl-row">
                  <span className="ctrl-label">Начало</span>
                  <span className="ctrl-value">{formatTime(startTime)}</span>
                </div>
                <input 
                  type="range" min="0" max={duration} step="0.01" value={startTime}
                  onChange={(e) => {
                    const val = Math.min(parseFloat(e.target.value), endTime - 0.1);
                    setStartTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                />

                <div className="ctrl-row" style={{ marginTop: '0.4rem' }}>
                  <span className="ctrl-label">Конец</span>
                  <span className="ctrl-value">{formatTime(endTime)}</span>
                </div>
                <input 
                  type="range" min="0" max={duration} step="0.01" value={endTime}
                  onChange={(e) => {
                    const val = Math.max(parseFloat(e.target.value), startTime + 0.1);
                    setEndTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                />

                <div className="time-display" style={{ marginTop: '0.3rem' }}>
                  <span>Длительность: <strong style={{ color: 'var(--accent-color)' }}>{formatTime(endTime - startTime)}</strong></span>
                  <span style={{ marginLeft: 'auto' }}>из {formatTime(duration)}</span>
                </div>
              </div>

              {/* ── Speed ── */}
              <div className="ctrl-section" style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }}>
                <div className="ctrl-section-title">⚡ Скорость</div>
                
                <div className="ctrl-row">
                  <span className="ctrl-label">Множитель</span>
                  <span className="ctrl-value" style={{ fontSize: '1.1rem' }}>{playbackSpeed.toFixed(2)}x</span>
                </div>
                <input 
                  className="speed-slider"
                  type="range" min="0.1" max="5.0" step="0.05" value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                />
                
                <div className="speed-presets">
                  {speedPresets.map(sp => (
                    <button 
                      key={sp}
                      className={`speed-btn ${Math.abs(playbackSpeed - sp) < 0.01 ? 'active' : ''}`}
                      onClick={() => setPlaybackSpeed(sp)}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Watermark ── */}
              <div className="ctrl-section">
                <div className="ctrl-row">
                  <span className="ctrl-section-title" style={{ marginBottom: 0 }}>🖼 Водяной знак</span>
                  {watermarkFile && (
                    <span className="wm-remove" onClick={() => { setWatermarkFile(null); setWatermarkUrl(''); }}>
                      ✕ Убрать
                    </span>
                  )}
                </div>
                
                <button className="wm-btn" onClick={openWatermarkPicker} style={{ marginTop: '0.4rem' }}>
                  {watermarkFile ? '↻ Заменить' : '+ Загрузить логотип'}
                </button>

                {watermarkFile && (
                  <>
                    <div className="ctrl-row" style={{ marginTop: '0.6rem' }}>
                      <span className="ctrl-label">Прозрачность</span>
                      <span className="ctrl-value">{Math.round(watermarkOpacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="1.0" step="0.05" value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))}
                    />
                    
                    <div className="ctrl-row" style={{ marginTop: '0.3rem' }}>
                      <span className="ctrl-label">Размер</span>
                      <span className="ctrl-value">{watermarkScale}%</span>
                    </div>
                    <input 
                      type="range" min="5" max="100" step="1" value={watermarkScale}
                      onChange={(e) => setWatermarkScale(parseInt(e.target.value, 10))}
                    />
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.3rem' }}>
                      Перетаскивайте логотип на видео
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="btn-actions" style={{ flexDirection: resultBlob ? 'column' : 'row', gap: resultBlob ? '0.4rem' : '0.5rem' }}>
              {resultBlob ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%' }}>
                    <input 
                      type="text"
                      className="filename-input"
                      value={resultFileName.replace(/\.mp4$/i, '')}
                      onChange={(e) => setResultFileName(e.target.value.replace(/\.mp4$/i, '') + '.mp4')}
                      placeholder="Имя файла"
                    />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', flexShrink: 0 }}>.mp4</span>
                  </div>
                  <button className="btn btn-download pulse-anim" onClick={handleDownload} style={{ width: '100%' }}>
                    ⬇ Скачать видео
                  </button>
                </>
              ) : (
                <>
                  <button 
                    className="btn btn-primary" 
                    onClick={trim} 
                    disabled={!loaded || processing}
                    style={{ flex: 2 }}
                  >
                    {processing ? '⏳ Обработка...' : '✂ Обрезать'}
                  </button>
                  <button 
                    className="btn btn-ghost" 
                    onClick={() => { setVideoFile(null); setResultBlob(null); }} 
                    disabled={processing}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="status-bar">
        <span className="last-log">{lastLog}</span>
        <span className="toggle-logs" onClick={() => setLogsExpanded(!logsExpanded)}>
          {logsExpanded ? '▾ Свернуть' : '▸ Логи'}
        </span>
      </div>
      {logsExpanded && (
        <div className="logs-expanded">
          {logs.map((log, i) => (
            <div key={i} style={{ color: log.includes('ОШИБКА') ? 'var(--error-color)' : 'inherit' }}>
              <span style={{ color: 'var(--accent-color)', marginRight: '6px' }}>$</span>
              {log}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App

