// ---------- creating items ----------

async function createNote(worldPoint, text = '', edit = true) {
  const item = {
    type: 'note',
    x: worldPoint.x,
    y: worldPoint.y,
    width: 190,
    height: 150,
    rotation: Math.floor(Math.random() * 5) - 2,
    z: nextZ(),
    text,
    color: '#f6e6a8',
    retro: true,
    taped: false,
  };
  try {
    const created = await api(`/api/items?slot=${state.currentSlot}`, { method: 'POST', body: JSON.stringify(item) });
    addLocalItem(created);
    if (edit) startEditing(created.id);
    else select(created.id);
  } catch (err) {
    console.warn(err);
    alert('Could not create note: ' + err.message);
  }
}

function addLocalItem(item) {
  state.items.set(item.id, item);
  renderItem(item);
  fitNote(item);
  renderStrings();
  updatePagination();
  maybeCommitHistory();
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  const dataUrl = await readAsDataURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  // Store the original bytes untouched — this is a local board, no need to re-encode.
  return {
    dataUrl,
    mime: file.type || 'image/png',
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  };
}

async function addImageFile(file, offset = 0) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const prepared = await prepareImage(file);
    const fit = Math.min(1, 320 / prepared.naturalWidth, 320 / prepared.naturalHeight);
    const displayW = Math.round(prepared.naturalWidth * fit);
    const displayH = Math.round(prepared.naturalHeight * fit);
    const rect = boardRect();
    const center = staggerPoint(
      screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2),
      offset
    );

    const item = {
      type: 'image',
      x: center.x,
      y: center.y,
      width: displayW + 20,
      height: displayH + 48,
      rotation: Math.floor(Math.random() * 5) - 2,
      z: nextZ(),
      imageBase64: prepared.dataUrl.split(',')[1] || prepared.dataUrl,
      mime: prepared.mime,
      filename: file.name,
      retro: true,
      caption: '',
    };

    const created = await api(`/api/items?slot=${state.currentSlot}`, { method: 'POST', body: JSON.stringify(item) });
    imageCache.set(created.id, prepared.dataUrl);
    addLocalItem(created);
    select(created.id);
  } catch (err) {
    console.warn(err);
    alert('Could not add image: ' + err.message);
  }
}

async function addTextFileAsNote(file, offset = 0) {
  try {
    const text = await file.text();
    const rect = boardRect();
    const point = staggerPoint(
      screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2),
      offset
    );
    await createNote(point, text, false);
  } catch (err) {
    console.warn(err);
    alert('Could not read text file: ' + err.message);
  }
}

async function handleFiles(files) {
  let offset = 0;
  for (const file of files) {
    if (file.type.startsWith('image/')) await addImageFile(file, offset);
    else if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) await addTextFileAsNote(file, offset);
    else continue;
    offset++;
  }
}

// ---------- strings ----------

async function handleStringClick(id) {
  if (!state.pendingLinkFrom) {
    state.pendingLinkFrom = id;
    renderAll();
    return;
  }
  if (state.pendingLinkFrom === id) {
    state.pendingLinkFrom = null;
    renderAll();
    return;
  }
  try {
    const link = await api(`/api/links?slot=${state.currentSlot}`, {
      method: 'POST',
      body: JSON.stringify({ a: state.pendingLinkFrom, b: id }),
    });
    if (link.removed) {
      state.links = state.links.filter((existing) => existing.id !== link.id);
    } else if (link.id) {
      state.links.push(link);
    }
  } catch (err) {
    console.warn(err);
  }
  state.pendingLinkFrom = id; // keep the last item highlighted so strings can be chained
  renderAll();
  maybeCommitHistory();
}

function toggleTape(id) {
  const item = state.items.get(id);
  if (!item) return;
  item.taped = !item.taped;
  renderItem(item);
  saveItem(item);
}
