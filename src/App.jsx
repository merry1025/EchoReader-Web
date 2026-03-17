import React, { useState, useEffect, useRef } from 'react';
import ePub from 'epubjs';
import { pipeline, env } from '@xenova/transformers';
import { 
  Upload, Play, Mic, MicOff, Menu, ChevronLeft, ChevronRight, 
  X, Bookmark, Trash2, Library, BookOpenText, Loader2
} from 'lucide-react';
import './App.css';

// AI 环境配置
env.allowLocalModels = false;
env.useBrowserCache = true;

const FONT_OPTIONS = [
  { label: '系统默认', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Georgia (衬线)', value: 'Georgia, serif' },
  { label: 'Arial (无衬线)', value: 'Arial, sans-serif' },
];

const functionWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "so", "yet", "at", "by", "from", "in", "into", "of", "on", "to", "with", "as", "about", "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers", "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs", "this", "that", "these", "those", "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could", "shall", "should", "will", "would", "may", "might", "must"]);

// --- IndexedDB 核心逻辑 ---
const DB_NAME = 'EchoReaderDB';
const STORE_NAME = 'books';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // 升级版本
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const getBooksFromDB = async () => {
  const db = await openDB();
  return new Promise((resolve) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
  });
};

const deleteBookFromDB = async (id) => {
  const db = await openDB();
  db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
};

// ==========================================
// --- 主组件 App ---
// ==========================================
function App() {
  const [viewMode, setViewMode] = useState('library');
  const [libraryBooks, setLibraryBooks] = useState([]);
  const [loading, setLoading] = useState(false);

  // 阅读器状态
  const [bookBlob, setBookBlob] = useState(null);
  const [book, setBook] = useState(null);
  const [rendition, setRendition] = useState(null);
  const [bookTitle, setBookTitle] = useState('EchoReader');
  const [theme, setTheme] = useState('theme-light');
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState(100);
  const [status, setStatus] = useState('✨ 就绪');
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
  const transcriberRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);

  // 1. 初始化 AI 和 数据
  useEffect(() => {
    const init = async () => {
      try {
        transcriberRef.current = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          progress_callback: (d) => d.status === 'progress' && d.file.includes('model') && setStatus(`⏳ 下载 AI: ${Math.round(d.progress)}%`)
        });
        setStatus('✨ AI 就绪');
      } catch (e) { setStatus('❌ AI 失败'); }
      loadLibrary();
    };
    init();

    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices().filter(x => x.lang.includes('en-US'));
      setVoices(v);
      if (v.length > 0) setSelectedVoice(v[0].voiceURI);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    const saved = localStorage.getItem('echoreader_local_favs');
    if (saved) setFavorites(JSON.parse(saved));
  }, []);

  const loadLibrary = async () => {
    const books = await getBooksFromDB();
    const withUrls = books.map(b => ({
      ...b,
      coverUrl: b.coverBlob ? URL.createObjectURL(b.coverBlob) : null
    }));
    setLibraryBooks(withUrls);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setStatus('⏳ 正在解析书架...');

    const buffer = await file.arrayBuffer();
    const tempBook = ePub(buffer);
    const meta = await tempBook.loaded.metadata;
    let coverBlob = null;
    const coverUrl = await tempBook.coverUrl();
    if (coverUrl) {
      const resp = await fetch(coverUrl);
      coverBlob = await resp.blob();
    }

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
      title: meta.title || file.name,
      author: meta.author || "未知作者",
      blob: new Blob([buffer], { type: file.type }),
      coverBlob: coverBlob
    });

    tx.oncomplete = () => {
      tempBook.destroy();
      loadLibrary();
      setLoading(false);
      setStatus('✨ 已存入书架');
    };
  };

  // 🌟 核心：打开书本并触发渲染循环
  const openBook = (item) => {
    setBookBlob(item.blob); // 存储原始文件
    setViewMode('reading'); // 切换视图
  };

  // 🌟 核心：当视图变为阅读模式且文件就绪时，初始化 EPUB.js
  useEffect(() => {
    if (viewMode !== 'reading' || !bookBlob || !viewerRef.current) return;

    console.log("正在初始化渲染容器...");
    const currentViewer = viewerRef.current;
    currentViewer.innerHTML = ''; // 清空

    const eブック = ePub(bookBlob);
    const rend = eブック.renderTo(currentViewer, {
      width: '100%', height: '100%', spread: 'none', manager: 'continuous', flow: 'paginated'
    });

    const isMobile = window.innerWidth <= 768;
    rend.themes.default({
      'p': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' },
      'div': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' }
    });

    rend.themes.register('theme-light', { body: { background: '#ffffff', color: '#333' }});
    rend.themes.register('theme-dark', { body: { background: '#121212', color: '#e0e0e0' }});
    rend.themes.select(theme);
    rend.themes.font(fontFamily);

    eブック.ready.then(() => {
      const meta = eブック.packaging.metadata;
      setBookTitle(meta.title || "未知书籍");
      const key = `echoreader_pos_${meta.title}`;
      const saved = localStorage.getItem(key);
      rend.display(saved || undefined);
      rend.on('relocated', (loc) => localStorage.setItem(key, loc.start.cfi));
    });

    eブック.loaded.navigation.then(nav => setToc(nav.toc || []));

    rend.on('selected', (cfi, contents) => {
      eブック.getRange(cfi).then(range => {
        const text = range.toString().trim();
        if (!text) return;
        setCurrentText(text);
        setRhythmHTML(generateRhythmHTML(text));
        const rect = contents.window.getSelection().getRangeAt(0).getBoundingClientRect();
        const iframeRect = contents.document.defaultView.frameElement.getBoundingClientRect();
        setPopupPos({ x: iframeRect.left + rect.left + (rect.width / 2), y: iframeRect.top + rect.top - 10 });
      });
    });

    rend.on('click', (e) => {
      setPopupPos(null);
      if (window.innerWidth <= 768) {
        const x = e.pageX;
        const w = window.innerWidth;
        if (x < w * 0.35) rend.prev();
        else if (x > w * 0.65) rend.next();
      }
    });

    setBook(eブック);
    setRendition(rend);

    return () => {
      rend.destroy();
      eブック.destroy();
    };
  }, [viewMode, bookBlob]);

  // 韵律引擎
  const generateRhythmHTML = (text) => {
    const tokens = text.split(/([a-zA-Z]+(?:'[a-zA-Z]+)?)/);
    return tokens.map(t => {
      if (!t.trim() || /^[^a-zA-Z]+$/.test(t)) return t;
      if (functionWords.has(t.toLowerCase())) return `<span style="color: #888;">'${t.toLowerCase()}</span>`;
      return `<u style="font-weight: 800; color: var(--primary-color); text-transform: uppercase;">${t}</u>`;
    }).join('');
  };

  const playTTS = () => {
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(currentText);
    const v = voices.find(x => x.voiceURI === selectedVoice);
    if (v) ut.voice = v;
    window.speechSynthesis.speak(ut);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      if (!currentText || !transcriberRef.current) return;
      setStatus('🎙️ 录音中...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        setStatus('⏳ AI 识别中...');
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const ac = new AudioContext({ sampleRate: 16000 });
        const buf = await ac.decodeAudioData(await blob.arrayBuffer());
        const out = await transcriberRef.current(buf.getChannelData(0));
        setStatus(`识别结果: "${out.text.trim()}"`);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
    }
  };

  // UI 组件
  if (viewMode === 'library') {
    return (
      <div className="bookshelf-container">
        <div className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Library /> <b>EchoReader 书架</b></div>
          <div className="toolbar">
            <label className="btn">
              <Upload size={16} /> 上传 EPUB
              <input type="file" accept=".epub" onChange={handleUpload} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
        <div className="library-status">{status}</div>
        <div className="bookshelf-grid">
          {libraryBooks.map(b => (
            <div key={b.id} className="book-card" onClick={() => openBook(b)}>
              <div className="book-cover-wrapper">
                {b.coverUrl ? <img src={b.coverUrl} className="book-cover" alt="" /> : <div className="no-cover">📖</div>}
                <button className="btn-delete-book" onClick={(e) => { e.stopPropagation(); deleteBookFromDB(b.id); loadLibrary(); }}><Trash2 size={16} /></button>
              </div>
              <div className="book-info"><b>{b.title}</b><p>{b.author}</p></div>
            </div>
          ))}
        </div>
        {loading && <div className="overlay"><Loader2 className="animate-spin" size={48} color="white" /></div>}
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn btn-icon" onClick={() => { setViewMode('library'); setBookBlob(null); }}><Library size={20} /></button>
          <button className="btn btn-icon hide-on-mobile" onClick={() => setShowToc(true)}><Menu size={20} /></button>
          <span className="hide-on-mobile"><b>{bookTitle}</b></span>
        </div>
        <div className="toolbar">
          <button className="btn btn-fav" onClick={() => setShowFavorites(true)}><Bookmark size={16} /> 收藏</button>
          <select className="select-theme" value={theme} onChange={e => setTheme(e.target.value)}>
            <option value="theme-light">☀️ 浅色</option>
            <option value="theme-dark">🌙 深色</option>
          </select>
        </div>
      </div>

      <div className="main-content">
        <button className="nav-btn nav-btn-left hide-on-mobile" onClick={() => rendition?.prev()}><ChevronLeft size={36} /></button>
        <div id="viewer" ref={viewerRef}></div>
        {popupPos && (
          <div className="selection-popup" style={{ left: popupPos.x, top: popupPos.y }}>
            <button className="popup-btn" onClick={() => {
              const item = { id: Date.now(), text: currentText, book: bookTitle, date: new Date().toLocaleString() };
              const newFavs = [item, ...favorites];
              setFavorites(newFavs);
              localStorage.setItem('echoreader_local_favs', JSON.stringify(newFavs));
              setPopupPos(null);
            }}>⭐ 收藏</button>
          </div>
        )}
        <button className="nav-btn nav-btn-right hide-on-mobile" onClick={() => rendition?.next()}><ChevronRight size={36} /></button>
      </div>

      <div className="scoring-panel">
        {rhythmHTML && <div className="rhythm-display" dangerouslySetInnerHTML={{ __html: rhythmHTML }} />}
        <div className="panel-controls">
          <div className="status-text">{status}</div>
          <div className="toolbar">
            <select className="voice-select" value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}>
              {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>🇺🇸 {v.name.split(' ')[1] || v.name}</option>)}
            </select>
            <button className="btn" onClick={playTTS}><Play size={16} /> 标准音</button>
            <button className="btn" onClick={toggleRecording} style={{ background: isRecording ? '#f44' : '#1a73e8' }}>{isRecording ? '结束' : '跟读'}</button>
          </div>
        </div>
      </div>

      <div className={`toc-sidebar ${showToc ? 'open' : ''}`}>
        <div className="toc-header"><b>目录</b><X onClick={() => setShowToc(false)} /></div>
        <div className="toc-content">{toc.map((t, i) => <div key={i} className="toc-item" onClick={() => { rendition.display(t.href); setShowToc(false); }}>{t.label}</div>)}</div>
      </div>

      <div className={`fav-sidebar ${showFavorites ? 'open' : ''}`}>
        <div className="toc-header"><b>收藏夹</b><X onClick={() => setShowFavorites(false)} /></div>
        <div className="toc-content">
          {favorites.map(f => <div key={f.id} className="fav-item"><p>{f.text}</p><small>{f.book}</small><Trash2 size={14} onClick={() => {
            const up = favorites.filter(x => x.id !== f.id);
            setFavorites(up);
            localStorage.setItem('echoreader_local_favs', JSON.stringify(up));
          }} /></div>)}
        </div>
      </div>

      {(showToc || showFavorites) && <div className="overlay" onClick={() => { setShowToc(false); setShowFavorites(false); }}></div>}
    </div>
  );
}

export default App;