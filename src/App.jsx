import React, { useState, useEffect, useRef } from 'react';
import ePub from 'epubjs';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, Play, Pause, Square, Menu, ChevronLeft, ChevronRight, 
  X, Bookmark, Trash2, Library, Volume2, Loader2
} from 'lucide-react';
import './App.css';

// 虚词列表：用于自动标记弱读
const functionWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "so", "yet", "at", "by", "from", "in", "into", "of", "on", "to", "with", "as", "about", "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers", "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs", "this", "that", "these", "those", "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could", "shall", "should", "will", "would", "may", "might", "must"]);

// --- IndexedDB 核心逻辑 ---
const DB_NAME = 'EchoReaderDB';
const STORE_NAME = 'books';

const openDB = () => {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
  });
};

const deleteBookFromDB = async (id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

function App() {
  const [viewMode, setViewMode] = useState('library');
  const [libraryBooks, setLibraryBooks] = useState([]);
  const [loading, setLoading] = useState(false);

  const [bookBlob, setBookBlob] = useState(null);
  const [book, setBook] = useState(null);
  const [rendition, setRendition] = useState(null);
  const [bookTitle, setBookTitle] = useState('EchoReader');
  const [theme, setTheme] = useState('theme-light');
  
  // 朗读与文本状态
  const [pageText, setPageText] = useState(''); 
  const [currentText, setCurrentText] = useState(''); 
  const [rhythmHTML, setRhythmHTML] = useState('');
  
  // 播放控制状态
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);

  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [toc, setToc] = useState([]);
  const [showToc, setShowToc] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [popupPos, setPopupPos] = useState(null);

  const viewerRef = useRef(null);
  const rhythmRef = useRef(null);

  // 1. 🌟 修复：不再过滤掉中文语音，获取系统内所有的语音库
  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      
      // UI 下拉框默认选用系统第一个英文发音
      setSelectedVoice(prev => {
        if (!prev) {
          const enVoices = v.filter(x => x.lang.includes('en'));
          return enVoices.length > 0 ? enVoices[0].voiceURI : (v.length > 0 ? v[0].voiceURI : '');
        }
        return prev;
      });
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    const saved = localStorage.getItem('echoreader_local_favs');
    if (saved) setFavorites(JSON.parse(saved));
    loadLibrary();

    return () => window.speechSynthesis.cancel();
  }, []);

  // 2. 主题同步
  useEffect(() => {
    document.body.className = theme;
    if (rendition) rendition.themes.select(theme);
  }, [theme, rendition]);

  const loadLibrary = async () => {
    const db = await openDB();
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      setLibraryBooks(request.result.map(b => ({
        ...b, coverUrl: b.coverBlob ? URL.createObjectURL(b.coverBlob) : null
      })));
    };
  };

  const openBook = (item) => {
    setBookBlob(item.blob);
    setViewMode('reading');
  };

  // CFI 锚点精确文本抓取
  const extractPageText = async (rendInstance, bookInstance) => {
    try {
      const loc = rendInstance.currentLocation();
      if (!loc || !loc.start || !loc.end) {
        setPageText("（无法获取页面位置）");
        return "";
      }

      const startRange = await bookInstance.getRange(loc.start.cfi);
      const endRange = await bookInstance.getRange(loc.end.cfi);

      if (startRange && endRange) {
        const doc = startRange.startContainer.ownerDocument;
        const pageRange = doc.createRange();
        
        pageRange.setStart(startRange.startContainer, startRange.startOffset);
        pageRange.setEnd(endRange.endContainer, endRange.endOffset);
        
        const text = pageRange.toString().replace(/\s+/g, ' ').trim();
        setPageText(text || "（当前页面可能为图片或无文字区域）");
        return text;
      }
    } catch (err) {
      console.error("页面文本抓取失败:", err);
      setPageText("（文本解析失败）");
      return "";
    }
  };

  // 韵律生成引擎 (实词大写、虚词变灰、卡拉OK高亮)
  const generateRhythmHTML = (text, highlightIndex = -1) => {
    if (!text) return '';
    const tokens = text.split(/([a-zA-Z]+(?:'[a-zA-Z]+)?|\s+|[^\w\s])/g).filter(Boolean);
    let runningCharCount = 0;

    return tokens.map((token, i) => {
      const start = runningCharCount;
      runningCharCount += token.length;
      
      const isActive = highlightIndex !== -1 && highlightIndex >= start && highlightIndex < runningCharCount;
      const highlightClass = isActive ? 'active-word-glow' : '';

      if (/^[a-zA-Z]+/.test(token)) {
        const cleanToken = token.toLowerCase();
        if (functionWords.has(cleanToken)) {
          return `<span key="${i}" class="${highlightClass}" style="color: var(--rhythm-grey);">'${cleanToken}</span>`;
        } else {
          return `<span key="${i}" class="${highlightClass}" style="font-weight: 800; color: var(--primary-color); text-transform: uppercase;">${token}</span>`;
        }
      }
      return `<span key="${i}" class="${highlightClass}">${token}</span>`;
    }).join('');
  };

  // 监听进度更新 UI
  useEffect(() => {
    const targetText = currentText || pageText;
    setRhythmHTML(generateRhythmHTML(targetText, activeCharIndex));
  }, [activeCharIndex, pageText, currentText]);

  // 自动平滑滚动
  useEffect(() => {
    if (rhythmRef.current && activeCharIndex !== -1) {
      const activeEl = rhythmRef.current.querySelector('.active-word-glow');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeCharIndex]);

  // --- 🌟 核心播放控制：智能双语切割引擎 ---
  const handlePlay = async () => {
    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    window.speechSynthesis.cancel(); 
    setActiveCharIndex(-1);

    let textToRead = currentText;

    if (!textToRead) {
      setPageText("⏳ 正在获取当前页面...");
      textToRead = await extractPageText(rendition, book);
    }

    if (!textToRead || textToRead.includes("（") || textToRead.includes("⏳")) return;
    
    setTimeout(() => {
      // 🌟 自动语种切分：按中文及其标点符号切分区块，过滤掉空串
      const blocks = textToRead.split(/([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]+)/g).filter(Boolean);
      let currentOffset = 0;

      // 利用 SpeechSynthesis 队列特性，将中英区块依次压入队列
      blocks.forEach((block, index) => {
        // 如果只是空格或换行，直接跳过不发音，但进度必须累加
        if (!block.trim() && !/[\u4e00-\u9fa5]/.test(block)) {
           currentOffset += block.length;
           return; 
        }

        const ut = new SpeechSynthesisUtterance(block);
        
        // 判断当前文字块是否含有中文
        const isZh = /[\u4e00-\u9fa5]/.test(block);

        if (isZh) {
          // 选用系统内置的中文字库（安卓和iOS对中文语言包的命名不同）
          ut.voice = voices.find(v => v.lang.toLowerCase().includes('zh') || v.lang.toLowerCase().includes('cmn')) || null;
        } else {
          // 选用用户在下拉菜单中指定的英文发音
          ut.voice = voices.find(v => v.voiceURI === selectedVoice) || voices.find(v => v.lang.includes('en')) || null;
        }
        
        ut.rate = 0.95; 

        const blockOffset = currentOffset;
        currentOffset += block.length;

        // 🌟 针对手机端的兼容性卡拉OK高亮
        ut.onstart = () => { 
          setIsSpeaking(true); 
          setIsPaused(false); 
          setActiveCharIndex(blockOffset); // 兜底策略：手机不触发 word 时也能亮起整块句首
        };
        
        ut.onboundary = (event) => {
          if (event.name === 'word') {
            setActiveCharIndex(blockOffset + event.charIndex);
          }
        };

        ut.onend = () => {
          // 只有当队列里最后一个块读完时，才重置状态
          if (index === blocks.length - 1) {
            setIsSpeaking(false); setIsPaused(false); setActiveCharIndex(-1);
          }
        };

        ut.onerror = (e) => { 
          console.error("Speech error:", e); 
          setIsSpeaking(false); setIsPaused(false); setActiveCharIndex(-1); 
        };

        window.speechSynthesis.speak(ut);
      });
    }, 50);
  };

  const handlePause = () => {
    if (window.speechSynthesis.speaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setActiveCharIndex(-1);
  };

  // --- 电子书渲染 ---
  useEffect(() => {
    if (viewMode !== 'reading' || !bookBlob) return;

    let rendInstance = null;
    let bookInstance = null;
    let isMounted = true;

    const timer = setTimeout(async () => {
      if (!viewerRef.current || viewMode !== 'reading' || !isMounted) return;
      viewerRef.current.innerHTML = ''; 

      try {
        const buffer = await bookBlob.arrayBuffer();
        if (!isMounted) return;

        bookInstance = ePub(buffer);
        rendInstance = bookInstance.renderTo(viewerRef.current, {
          width: '100%', height: '100%', spread: 'none', manager: 'continuous', flow: 'paginated'
        });

        const isMobile = window.innerWidth <= 768;
        rendInstance.themes.default({
          'p': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' },
          'div': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' }
        });

        rendInstance.themes.register('theme-light', { body: { background: '#ffffff', color: '#333' }});
        rendInstance.themes.register('theme-dark', { body: { background: '#121212', color: '#e0e0e0' }});
        rendInstance.themes.select(theme);

        bookInstance.ready.then(() => {
          setBook(bookInstance);
          const meta = bookInstance.packaging.metadata;
          setBookTitle(meta.title || "未知书籍");
          const key = `echoreader_pos_${meta.title}`;
          
          rendInstance.display(localStorage.getItem(key) || undefined).then(() => {
            extractPageText(rendInstance, bookInstance);
          });

          bookInstance.loaded.navigation.then(nav => {
            setToc(nav.toc || []);
          });

          rendInstance.on('relocated', (loc) => {
            localStorage.setItem(key, loc.start.cfi);
            setCurrentText(''); 
            handleStop(); 
            extractPageText(rendInstance, bookInstance); 
          });
        });

        rendInstance.hooks.content.register((contents) => {
          const body = contents.window.document.body;
          let touchStartX = 0;
          body.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
          body.addEventListener('touchend', (e) => {
            const diff = e.changedTouches[0].clientX - touchStartX;
            if (window.innerWidth <= 768) {
              if (diff < -50) rendInstance.next();
              if (diff > 50) rendInstance.prev();
            }
          }, { passive: true });
        });

        rendInstance.on('selected', (cfi, contents) => {
          bookInstance.getRange(cfi).then(range => {
            const text = range.toString().trim();
            if (!text) return;
            setCurrentText(text);
            handleStop(); 
            const rect = contents.window.getSelection().getRangeAt(0).getBoundingClientRect();
            const iframeRect = contents.document.defaultView.frameElement.getBoundingClientRect();
            setPopupPos({ x: iframeRect.left + rect.left + (rect.width / 2), y: iframeRect.top + rect.top - 10 });
          });
        });

        rendInstance.on('click', (e) => {
          setPopupPos(null);
          
          const sel = e.view.document.getSelection();
          if (sel && sel.toString().trim().length > 0) return;
          
          setCurrentText('');

          const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
          if (isTouchDevice && window.innerWidth <= 1024) {
            const screenWidth = e.view.innerWidth;
            if (e.clientX < screenWidth * 0.35) rendInstance.prev();
            else if (e.clientX > screenWidth * 0.65) rendInstance.next();
          }
        });

        setRendition(rendInstance);
      } catch (err) {
        console.error("书籍渲染失败: ", err);
      }
    }, 400); 

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (rendInstance) rendInstance.destroy();
      if (bookInstance) bookInstance.destroy();
    };
  }, [viewMode, bookBlob]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (viewMode === 'reading' && rendition) {
        if (e.key === 'ArrowRight') rendition.next();
        if (e.key === 'ArrowLeft') rendition.prev();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [viewMode, rendition]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const buffer = await file.arrayBuffer();
    const epub = ePub(buffer);
    const meta = await epub.loaded.metadata;
    let coverBlob = null;
    const coverUrl = await epub.coverUrl();
    if (coverUrl) { const resp = await fetch(coverUrl); coverBlob = await resp.blob(); }
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ title: meta.title || file.name, blob: new Blob([buffer]), coverBlob });
    tx.oncomplete = () => { epub.destroy(); loadLibrary(); setLoading(false); };
  };

  const syncFavs = (newList) => {
    setFavorites(newList);
    localStorage.setItem('echoreader_local_favs', JSON.stringify(newList));
  };

  const pageVariants = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };
  const sidebarVariants = { closed: { x: "100%" }, open: { x: 0 } };

  return (
    <div className="app-container">
      <AnimatePresence mode="wait">
        {viewMode === 'library' ? (
          <motion.div key="library" className="bookshelf-container" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <div className="header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Library /> <b>EchoReader</b></div>
              <div className="toolbar">
                <select className="select-theme" value={theme} onChange={e => setTheme(e.target.value)}>
                  <option value="theme-light">☀️ 浅色</option>
                  <option value="theme-dark">🌙 深色</option>
                </select>
                <button className="btn btn-fav" onClick={() => setShowFavorites(true)} style={{backgroundColor: '#FF9900', color: '#000'}}><Bookmark size={16} /> 收藏</button>
                <label className="btn">
                  <Upload size={16} /> 上传
                  <input type="file" accept=".epub" onChange={handleUpload} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
            <div className="bookshelf-grid">
              {libraryBooks.map((b, index) => (
                <motion.div key={b.id} className="book-card" onClick={() => {openBook(b); handleStop();}} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: { delay: index * 0.05 } }}>
                  <div className="book-cover-wrapper">
                    {b.coverUrl ? <img src={b.coverUrl} className="book-cover" alt="" /> : <div className="no-cover">📖</div>}
                    <button className="btn-delete-book" onClick={async (e) => { 
                      e.stopPropagation(); 
                      try {
                        await deleteBookFromDB(b.id); 
                        await loadLibrary(); 
                      } catch(err) { console.error(err); }
                    }}><Trash2 size={16} /></button>
                  </div>
                  <div className="book-info"><b>{b.title}</b></div>
                </motion.div>
              ))}
            </div>
            {loading && <div className="overlay"><Loader2 className="animate-spin" size={48} color="white" /></div>}
          </motion.div>
        ) : (
          <motion.div key="reader" className="reader-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            
            <div className="header" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <button className="btn btn-icon" onClick={() => { setViewMode('library'); setBookBlob(null); handleStop(); }} title="返回"><Library size={20} /></button>
                {/* 🌟 修复：彻底移除了手机端不显示目录按钮的 class */}
                <button className="btn btn-icon" onClick={() => setShowToc(true)} title="目录"><Menu size={20} /></button>
              </div>
              
              <div className="control-toolbar" style={{ display: 'flex', gap: '8px', flex: 1, justifyContent: 'center' }}>
                {!isSpeaking || isPaused ? (
                  <button className="btn btn-control" onClick={handlePlay}>
                    <Play size={16} /> <span className="hide-on-mobile">{currentText ? '读选区' : '自动朗读'}</span>
                  </button>
                ) : (
                  <button className="btn btn-control" style={{ backgroundColor: '#FF9900', color: '#000' }} onClick={handlePause}>
                    <Pause size={16} /> <span className="hide-on-mobile">暂停</span>
                  </button>
                )}
                {(isSpeaking || isPaused) && (
                  <button className="btn btn-control dark" onClick={handleStop}>
                    <Square size={16} /> <span className="hide-on-mobile">停止</span>
                  </button>
                )}
              </div>

              <div className="toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* 仅过滤出英文语音展示给用户，系统保留中文 */}
                <select className="voice-select hide-on-mobile" value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}>
                  {voices.filter(v => v.lang.includes('en')).map(v => <option key={v.voiceURI} value={v.voiceURI}>🇺🇸 {v.name.split(' ')[1] || v.name}</option>)}
                </select>
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
                <motion.div className="selection-popup" style={{ left: popupPos.x, top: popupPos.y }} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}>
                  <button className="popup-btn" onClick={() => {
                    const item = { id: Date.now(), text: currentText, book: bookTitle, date: new Date().toLocaleString() };
                    syncFavs([item, ...favorites]);
                    setPopupPos(null);
                  }}>⭐ 收藏</button>
                </motion.div>
              )}
              <button className="nav-btn nav-btn-right hide-on-mobile" onClick={() => rendition?.next()}><ChevronRight size={36} /></button>
            </div>

            <div className="scoring-panel">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                <div className="feedback-title" style={{margin: 0}}>
                  <Volume2 size={14} /> 实时朗读区域 {activeCharIndex !== -1 && <span className="karaoke-badge">双语播放中</span>}
                </div>
                <div className="show-on-mobile-only" style={{display: 'none'}}>
                  <select className="voice-select" style={{padding: '2px 4px', fontSize: '12px'}} value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}>
                    {voices.filter(v => v.lang.includes('en')).map(v => <option key={v.voiceURI} value={v.voiceURI}>语音 {v.name.split(' ')[1] || 'Default'}</option>)}
                  </select>
                </div>
              </div>
              
              <div 
                ref={rhythmRef}
                className="rhythm-display karaoke-mode" 
                dangerouslySetInnerHTML={{ __html: rhythmHTML || "<p style='color:var(--text-color); opacity: 0.6; text-align:center; font-size:14px; margin:0;'>准备朗读... 点击上方自动朗读或划选文字</p>" }} 
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showToc && (
          <><motion.div className="overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setShowToc(false)} />
          <motion.div className="toc-sidebar" variants={sidebarVariants} initial="closed" animate="open" exit="closed" style={{left:0, right:'auto'}}>
            <div className="toc-header"><b>目录</b><X onClick={()=>setShowToc(false)} /></div>
            <div className="toc-content">{toc.map((t, i) => <div key={i} className="toc-item" onClick={()=>{rendition.display(t.href); setShowToc(false)}}>{t.label}</div>)}</div>
          </motion.div></>
        )}
        {showFavorites && (
          <><motion.div className="overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setShowFavorites(false)} />
          <motion.div className="fav-sidebar" variants={sidebarVariants} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}>
            <div className="toc-header"><b>收藏夹</b><X onClick={()=>setShowFavorites(false)} /></div>
            <div className="toc-content">{favorites.length === 0 ? <p style={{textAlign:'center', padding:'20px'}}>暂无内容</p> : 
              favorites.map(f => (<div key={f.id} className="fav-item"><p>{f.text}</p><div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}><small style={{color:'var(--primary-color)'}}>📖 {f.book}</small><Trash2 size={14} style={{cursor:'pointer', color:'#ff4444'}} onClick={() => syncFavs(favorites.filter(x => x.id !== f.id))} /></div></div>))
            }</div>
          </motion.div></>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;