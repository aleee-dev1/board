// ---------- api ----------

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.json();
}

// The standalone build swaps these globals for blob-URL versions. The server
// build just falls back to the usual image endpoint.
function imageUrl(id) {
  return window.boardImageUrl ? window.boardImageUrl(id) : `/api/items/${id}/image`;
}

function fetchImage(id) {
  return window.boardImageFetch ? window.boardImageFetch(id) : fetch(`/api/items/${id}/image`);
}
