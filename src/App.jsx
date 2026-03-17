import React, { useState, useEffect, useRef } from 'react';
import ePub from 'epubjs';
import { pipeline, env } from '@xenova/transformers';
import { 
  Upload, Play, Mic, MicOff, Menu, ChevronLeft, ChevronRight, 
  X, Bookmark, Trash2 
} from 'lucide-react';
import './App.css';

// AI 配置优化
env.allowLocalModels = false;
env.useBrowserCache = true;

const FONT_OPTIONS = [
  { label: '系统默认', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Georgia (衬线)', value: 'Georgia, serif' },
  { label: 'Palatino (优雅)', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial (无衬线)', value: 'Arial, sans-serif' },
  { label: 'Verdana (宽大)', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Courier New (等宽)', value: '"Courier New", Courier, monospace' },
];

function App() {
  const [book, setBook] = useState(null);
  const [rendition, setRendition] = useState(null);
  const [bookTitle, setBookTitle] = useState('未知书籍');
  const [theme, setTheme] = useState('theme-light');
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState(100);
  const [status, setStatus] = useState('请上传 EPUB 书籍');
  const [isRecording, setIsRecording] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const [rhythmHTML, setRhythmHTML] = useState('');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [toc, setToc] = useState([]);
  const [showToc, setShowToc] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [popupPos, setPopupPos] = useState(null);

  const viewerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const transcriberRef = useRef(null);

  useEffect(() => {
    const savedFavs = localStorage.getItem('echoreader_local_favs');
    if (savedFavs) setFavorites(JSON.parse(savedFavs));
  }, []);

  useEffect(() => {
    const loadAI = async () => {
      setStatus('⏳ 准备连接 AI 服务器...');
      try {
        transcriberRef.current = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          progress_callback: (data) => {
            if (data.status === 'progress' && data.file.includes('model')) 
              setStatus(`⏳ 下载引擎: ${Math.round(data.progress)}%`);
          }
        });
        setStatus('✨ AI 就绪，请上传书籍！');
      } catch (err) { setStatus('❌ AI 加载失败'); }
    };
    loadAI();

    const loadVoices = () => {
      const usVoices = window.speechSynthesis.getVoices().filter(v => v.lang.includes('en-US'));
      setVoices(usVoices);
      if (usVoices.length > 0) setSelectedVoice(usVoices[0].voiceURI);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    document.body.className = theme;
    if (rendition) {
      rendition.themes.select(theme);
      rendition.themes.font(fontFamily);
    }
  }, [theme, fontFamily, rendition]);

  // 🌟 核心优化：韵律分析引擎 (实词大写 + 下划线 | 虚词前缀 ')
  const generateRhythmHTML = (text) => {
    if (!text) return '';
    
    // 英语虚词库：代词、介词、冠词、连词、助动词
    const functionWords = new Set([
      "a", "an", "the", "and", "but", "or", "for", "nor", "so", "yet",
      "at", "by", "from", "in", "into", "of", "on", "to", "with", "as", "about",
      "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his",
      "she", "her", "hers", "it", "its", "we", "us", "our", "ours", "they",
      "them", "their", "theirs", "this", "that", "these", "those",
      "is", "am", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did",
      "can", "could", "shall", "should", "will", "would", "may", "might", "must"
    ]);

    // 使用正则将单词和符号分开处理
    const tokens = text.split(/([a-zA-Z]+(?:'[a-zA-Z]+)?)/);
    
    return tokens.map(token => {
      if (!token.trim() || /^[^a-zA-Z]+$/.test(token)) return token; // 标点和空白直接返回
      
      const cleanWord = token.toLowerCase();
      
      if (functionWords.has(cleanWord)) {
        // 虚词 (Unstressed): 小写，带上撇号，变灰
        return `<span style="color: #888888; font-weight: normal; font-size: 0.95em;">'${cleanWord}</span>`;
      } else {
        // 实词 (Stressed): 转换为大写，加粗，带下划线，使用主题色
        return `<u style="font-weight: 800; color: var(--primary-color); text-transform: uppercase;">${token}</u>`;
      }
    }).join('');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setStatus('⏳ 正在解析书籍...');
      const reader = new FileReader();
      reader.onload = (event) => renderBook(event.target.result);
      reader.readAsArrayBuffer(file);
    }
  };

  const renderBook = (bookData) => {
    if (rendition) rendition.destroy();
    if (book) book.destroy();
    if (viewerRef.current) viewerRef.current.innerHTML = '';
    
    const newBook = ePub(bookData);
    setBook(newBook);
    const newRendition = newBook.renderTo(viewerRef.current, {
      width: '100%', height: '100%', spread: 'none', manager: 'continuous', flow: 'paginated'
    });

    const isMobile = window.innerWidth <= 768;
    newRendition.themes.default({
      'p': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' },
      'div': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' }
    });

    newRendition.themes.register('theme-light', { body: { background: '#ffffff', color: '#333' }});
    newRendition.themes.register('theme-dark', { body: { background: '#121212', color: '#e0e0e0' }});
    newRendition.themes.select(theme);
    newRendition.themes.fontSize(`${fontSize}%`);
    newRendition.themes.font(fontFamily);

    newBook.ready.then(() => {
      const title = newBook.packaging.metadata.title || 'default_book';
      setBookTitle(title);
      const storageKey = `echoreader_pos_${title}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) newRendition.display(saved);
      else newRendition.display();

      newRendition.on('relocated', (loc) => {
        localStorage.setItem(storageKey, loc.start.cfi);
      });
    });

    newBook.loaded.navigation.then(nav => setToc(Array.isArray(nav) ? nav : (nav.toc || [])));

    newRendition.on('selected', (cfi, contents) => {
      newBook.getRange(cfi).then(range => {
        const text = range.toString().trim();
        if (!text) return;
        setCurrentText(text);
        
        // 更新韵律显示
        setRhythmHTML(generateRhythmHTML(text));
        
        const rect = contents.window.getSelection().getRangeAt(0).getBoundingClientRect();
        const iframeRect = contents.document.defaultView.frameElement.getBoundingClientRect();
        setPopupPos({ x: iframeRect.left + rect.left + (rect.width / 2), y: iframeRect.top + rect.top - 10 });
      });
    });

    newRendition.on('click', (e) => {
      setPopupPos(null);
      const sel = e.view.document.getSelection();
      if (sel && sel.toString().trim().length > 0) return;
      if (window.innerWidth <= 768) {
        if (e.clientX < e.view.innerWidth * 0.35) newRendition.prev();
        else if (e.clientX > e.view.innerWidth * 0.65) newRendition.next();
      }
    });

    setRendition(newRendition);
  };

  const saveFav = (newFavs) => {
    setFavorites(newFavs);
    localStorage.setItem('echoreader_local_favs', JSON.stringify(newFavs));
  };

  const addToFavorites = () => {
    const newItem = { id: Date.now(), text: currentText, book: bookTitle, date: new Date().toLocaleString() };
    saveFav([newItem, ...favorites]);
    setPopupPos(null);
    setStatus('⭐ 已收藏');
  };

  const deleteFavorite = (id) => {
    const newFavs = favorites.filter(f => f.id !== id);
    saveFav(newFavs);
  };

  const playTTS = () => {
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(currentText);
    const v = voices.find(v => v.voiceURI === selectedVoice);
    if (v) ut.voice = v;
    window.speechSynthesis.speak(ut);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        mediaRecorderRef.current = mr;
        audioChunksRef.current = [];
        mr.ondataavailable = e => audioChunksRef.current.push(e.data);
        mr.onstop = async () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const ac = new AudioContext({ sampleRate: 16000 });
          const buf = await ac.decodeAudioData(await blob.arrayBuffer());
          const out = await transcriberRef.current(buf.getChannelData(0));
          setStatus(`识别结果: "${out.text.trim()}"`);
          stream.getTracks().forEach(t => t.stop());
        };
        mr.start();
        setIsRecording(true);
      } catch (err) { setStatus("❌ 麦克风开启失败"); }
    }
  };

  return (
    <div className="app-container">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button className="btn btn-icon" onClick={() => setShowToc(true)}><Menu size={20} /></button>
          <div style={{ fontWeight: 'bold', fontSize: '20px', color: 'var(--primary-color)' }}>EchoReader</div>
        </div>
        
        <div className="toolbar">
          <button className="btn btn-upload" onClick={() => setShowFavorites(true)} style={{backgroundColor: '#FF9900', color: '#000'}}><Bookmark size={16} /> 收藏夹</button>
          <label className="btn btn-upload">
            <Upload size={16} /> <span className="hide-on-mobile">上传 EPUB</span>
            <input type="file" accept=".epub" onChange={handleFileUpload} style={{display:'none'}} />
          </label>
          <select className="select-theme" value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
            {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select className="select-theme hide-on-mobile" value={theme} onChange={e => setTheme(e.target.value)}>
            <option value="theme-light">☀️ 浅色模式</option>
            <option value="theme-dark">🌙 深色模式</option>
          </select>
        </div>
      </div>

      <div className={`toc-sidebar ${showToc ? 'open' : ''}`}>
        <div className="toc-header"><h3>目录</h3><X size={20} style={{cursor:'pointer'}} onClick={() => setShowToc(false)} /></div>
        <div className="toc-content">{toc.map((t, i) => <div key={i} className="toc-item" onClick={() => {rendition.display(t.href); setShowToc(false)}}>{t.label}</div>)}</div>
      </div>

      <div className={`fav-sidebar ${showFavorites ? 'open' : ''}`}>
        <div className="toc-header"><h3>⭐ 收藏夹</h3><X size={20} style={{cursor:'pointer'}} onClick={() => setShowFavorites(false)} /></div>
        <div className="toc-content">
          {favorites.length === 0 ? <p style={{textAlign:'center', padding:'20px'}}>暂无收藏内容</p> : 
            favorites.map(f => (
              <div key={f.id} className="fav-item">
                <div className="fav-text">{f.text}</div>
                <div className="fav-meta">
                  <span>📖 {f.book}</span>
                  <Trash2 size={14} style={{cursor:'pointer', color:'#ff4444'}} onClick={() => deleteFavorite(f.id)} />
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div className="main-content">
        <button className="nav-btn nav-btn-left hide-on-mobile" onClick={() => rendition?.prev()}><ChevronLeft size={36} /></button>
        <div id="viewer" ref={viewerRef}></div>
        {popupPos && (
          <div className="selection-popup" style={{ left: popupPos.x, top: popupPos.y }}>
            <button className="popup-btn" onClick={addToFavorites}>⭐ 加入收藏</button>
          </div>
        )}
        <button className="nav-btn nav-btn-right hide-on-mobile" onClick={() => rendition?.next()}><ChevronRight size={36} /></button>
      </div>

      <div className="scoring-panel" style={{flexDirection:'column', alignItems:'flex-start', gap:'10px'}}>
        {/* 🌟 韵律显示区域 */}
        {rhythmHTML && (
          <div className="rhythm-display" dangerouslySetInnerHTML={{ __html: rhythmHTML }} />
        )}
        <div style={{display:'flex', width:'100%', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'10px'}}>
          <div className="status-text">{status}</div>
          <div className="toolbar">
            <select className="voice-select" value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}>
              {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>🇺🇸 {v.name.split(' ')[1] || v.name}</option>)}
            </select>
            <button className="btn" onClick={playTTS}><Play size={16} /> 听标准音</button>
            <button className="btn" onClick={toggleRecording} style={{backgroundColor: isRecording ? '#f44' : '#1a73e8'}}>{isRecording ? '结束' : '跟读'}</button>
          </div>
        </div>
      </div>
      {(showToc || showFavorites) && <div className="overlay" onClick={() => {setShowToc(false); setShowFavorites(false)}} />}
    </div>
  );
}

export default App;