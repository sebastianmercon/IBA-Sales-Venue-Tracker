async function enrichProspectWithPlaces({ apiKey, venueName, latitude, longitude }) {
  const trimmedName = String(venueName || '').trim();
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  }
  if (!trimmedName) {
    throw new Error('venueName is required');
  }

  const textQueryUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  textQueryUrl.searchParams.set('query', trimmedName);
  textQueryUrl.searchParams.set('key', apiKey);

  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    textQueryUrl.searchParams.set('location', `${lat},${lng}`);
    textQueryUrl.searchParams.set('radius', '5000');
  }

  const textSearchResponse = await fetch(textQueryUrl);
  if (!textSearchResponse.ok) {
    throw new Error(`Places text search failed with ${textSearchResponse.status}`);
  }
  const textSearchData = await textSearchResponse.json();
  if (!Array.isArray(textSearchData.results) || textSearchData.results.length === 0) {
    return { success: true, suggestions: [], status: textSearchData.status || 'ZERO_RESULTS' };
  }

  const topMatches = textSearchData.results.slice(0, 3);
  const suggestions = [];

  for (const match of topMatches) {
    const placeId = match.place_id;
    let details = null;
    if (placeId) {
      const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      detailsUrl.searchParams.set('place_id', placeId);
      detailsUrl.searchParams.set(
        'fields',
        'name,formatted_address,formatted_phone_number,international_phone_number,website,geometry,types'
      );
      detailsUrl.searchParams.set('key', apiKey);
      const detailsResponse = await fetch(detailsUrl);
      if (detailsResponse.ok) {
        const detailsData = await detailsResponse.json();
        details = detailsData.result || null;
      }
    }

    suggestions.push({
      placeId: placeId || '',
      venueName: details?.name || match.name || trimmedName,
      address: details?.formatted_address || match.formatted_address || '',
      contactPhone: details?.formatted_phone_number || details?.international_phone_number || '',
      website: details?.website || '',
      latitude: details?.geometry?.location?.lat ?? match?.geometry?.location?.lat ?? null,
      longitude: details?.geometry?.location?.lng ?? match?.geometry?.location?.lng ?? null,
      types: details?.types || match.types || [],
      confidence: placeId ? 'high' : 'medium',
    });
  }

  return {
    success: true,
    suggestions,
    status: textSearchData.status || 'OK',
  };
}

module.exports = {
  enrichProspectWithPlaces,
};
