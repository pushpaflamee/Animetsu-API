const axios = require('axios');
const cache = require('../utils/cache');

const ANILIST_URL = process.env.ANILIST_API_URL || 'https://graphql.anilist.co';

const FULL_ANIME_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    type
    format
    status
    title { romaji english native }
    description(asHtml: false)
    startDate { year month day }
    endDate { year month day }
    season
    seasonYear
    episodes
    duration
    countryOfOrigin
    source
    hashtag
    isAdult
    averageScore
    meanScore
    popularity
    favourites
    trending
    coverImage { extraLarge large medium color }
    bannerImage
    trailer { id }
    genres
    synonyms
    tags { name }
    nextAiringEpisode { episode airingAt }
    rankings { rank context allTime }
    relations {
      edges {
        relationType
        node {
          id
          idMal
          type
          format
          status
          season
          seasonYear
          episodes
          duration
          title { romaji english native }
          description(asHtml: false)
          startDate { year month day }
          averageScore
          genres
          coverImage { extraLarge large medium }
          bannerImage
          trailer { id }
        }
      }
    }
    recommendations(perPage: 3, sort: [RATING_DESC]) {
      nodes {
        mediaRecommendation {
          id
          idMal
          type
          format
          status
          season
          seasonYear
          episodes
          duration
          title { romaji english native }
          description(asHtml: false)
          startDate { year month day }
          averageScore
          genres
          coverImage { extraLarge large medium }
          bannerImage
          trailer { id }
        }
      }
    }
    characters(perPage: 25, sort: [ROLE, RELEVANCE]) {
      edges {
        role
        node {
          id
          name { full }
          image { large }
        }
        voiceActors(language: JAPANESE) {
          id
          name { full }
          image { large }
          languageV2
        }
      }
    }
    staff(perPage: 15) {
      edges {
        role
        node {
          id
          name { full }
          image { large }
          languageV2
        }
      }
    }
    studios {
      edges {
        isMain
        node { id name }
      }
    }
  }
}
`;

const SEARCH_QUERY = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(search: $search, type: ANIME) {
      id
      idMal
      type
      format
      status
      season
      seasonYear
      episodes
      duration
      title { romaji english native }
      description(asHtml: false)
      startDate { year month day }
      averageScore
      genres
      synonyms
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
}
`;

const anilistAxios = axios.create({
  baseURL: ANILIST_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

async function fetchAnime(anilist_id) {
  const cacheKey = `anilist:full:${anilist_id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let response;
  try {
    response = await anilistAxios.post('', {
      query: FULL_ANIME_QUERY,
      variables: { id: Number(anilist_id) }
    });
  } catch (err) {
    if (err.response?.data?.errors) {
      console.error('[AniList] Errors:', JSON.stringify(err.response.data.errors, null, 2));
    }
    throw err;
  }

  if (response.data.errors) {
    console.error('[AniList] Errors:', JSON.stringify(response.data.errors, null, 2));
    const msg = response.data.errors.map(e => e.message).join(', ');
    throw new Error(`AniList GraphQL error: ${msg}`);
  }

  const result = response.data.data?.Media;
  if (!result) throw new Error(`No media found for anilist_id ${anilist_id}`);

  cache.set(cacheKey, result);
  return result;
}

async function searchAnime(query, page = 1, perPage = 20) {
  let response;
  try {
    response = await anilistAxios.post('', {
      query: SEARCH_QUERY,
      variables: { search: query, page: Number(page), perPage: Number(perPage) }
    });
  } catch (err) {
    if (err.response?.data?.errors) {
      console.error('[AniList] Search errors:', JSON.stringify(err.response.data.errors, null, 2));
    }
    throw err;
  }

  if (response.data.errors) {
    console.error('[AniList] Search errors:', JSON.stringify(response.data.errors, null, 2));
    const msg = response.data.errors.map(e => e.message).join(', ');
    throw new Error(`AniList GraphQL error: ${msg}`);
  }

  return response.data.data?.Page?.media || [];
}

// ─────────────────────────────────────────────────────────────
// Fetch recently aired episodes from AniList airingSchedule
// Returns episodes that aired in the past N hours, newest first.
// ─────────────────────────────────────────────────────────────
const RECENTLY_AIRED_QUERY = `
query ($airedBefore: Int, $airedAfter: Int, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    airingSchedules(
      airingAt_lesser: $airedBefore
      airingAt_greater: $airedAfter
      sort: TIME_DESC
    ) {
      episode
      airingAt
      media {
        id
        title { romaji english native }
        status
        isAdult
        coverImage { extraLarge large medium }
        bannerImage
        seasonYear
        characters(perPage: 25, sort: [ROLE, RELEVANCE]) {
          edges {
            role
            node {
              id
              name { full }
              image { large }
            }
            voiceActors(language: JAPANESE) {
              id
              name { full }
              image { large }
              languageV2
            }
          }
        }
      }
    }
  }
}
`;

async function fetchRecentlyAired({ page = 1, perPage = 12 } = {}) {
  const now         = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;

  const cacheKey = `anilist:recently_aired:p${page}:pp${perPage}`;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  let response;
  try {
    response = await anilistAxios.post('', {
      query:     RECENTLY_AIRED_QUERY,
      variables: {
        airedBefore: now,
        airedAfter:  sevenDaysAgo,
        page:        Number(page),
        perPage:     Number(perPage)
      }
    });
  } catch (err) {
    if (err.response?.data?.errors) {
      console.error('[AniList] fetchRecentlyAired errors:', JSON.stringify(err.response.data.errors, null, 2));
    }
    throw err;
  }

  if (response.data.errors) {
    const msg = response.data.errors.map(e => e.message).join(', ');
    throw new Error(`AniList GraphQL error: ${msg}`);
  }

  const result = {
    pageInfo:  response.data.data?.Page?.pageInfo || {},
    schedules: response.data.data?.Page?.airingSchedules || []
  };

  // Short TTL — air times are time-sensitive
  cache.set(cacheKey, result, 120);
  return result;
}

// ─────────────────────────────────────────────────────────────
// Fetch home page data: seasonal, trending, popular, top, upcoming
// All sections fetched in a single batched GraphQL request.
// ─────────────────────────────────────────────────────────────
const HOME_QUERY = `
query (
  $season: MediaSeason, $seasonYear: Int,
  $nextSeason: MediaSeason, $nextYear: Int
) {
  seasonal: Page(page: 1, perPage: 20) {
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      ...HomeMediaFields
    }
  }
  trending: Page(page: 1, perPage: 20) {
    media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
      ...HomeMediaFields
    }
  }
  popular: Page(page: 1, perPage: 20) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      ...HomeMediaFields
    }
  }
  top: Page(page: 1, perPage: 20) {
    media(type: ANIME, sort: SCORE_DESC, isAdult: false) {
      ...HomeMediaFields
    }
  }
  upcoming: Page(page: 1, perPage: 20) {
    media(season: $nextSeason, seasonYear: $nextYear, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      ...HomeMediaFields
    }
  }
}

fragment HomeMediaFields on Media {
  id
  title { romaji english native }
  status
  isAdult
  coverImage { extraLarge large medium color }
  bannerImage
  description(asHtml: false)
  source
  episodes
  startDate { year month day }
  endDate { year month day }
  season
  seasonYear
  format
  duration
  averageScore
  genres
  trailer { id }
  nextAiringEpisode { airingAt episode }
  studios { edges { isMain node { id name } } }
}
`;

function getCurrentSeason() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 1  && month <= 3)  return 'WINTER';
  if (month >= 4  && month <= 6)  return 'SPRING';
  if (month >= 7  && month <= 9)  return 'SUMMER';
  return 'FALL';
}

function getNextSeason(season) {
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  return order[(order.indexOf(season) + 1) % 4];
}

async function fetchHome() {
  const cacheKey = 'anilist:home';
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  const now        = new Date();
  const year       = now.getFullYear();
  const season     = getCurrentSeason();
  const nextSeason = getNextSeason(season);
  const nextYear   = nextSeason === 'WINTER' ? year + 1 : year;

  let response;
  try {
    response = await anilistAxios.post('', {
      query:     HOME_QUERY,
      variables: { season, seasonYear: year, nextSeason, nextYear }
    });
  } catch (err) {
    if (err.response?.data?.errors) {
      console.error('[AniList] fetchHome errors:', JSON.stringify(err.response.data.errors, null, 2));
    }
    throw err;
  }

  if (response.data.errors) {
    const msg = response.data.errors.map(e => e.message).join(', ');
    throw new Error(`AniList GraphQL error: ${msg}`);
  }

  const data   = response.data.data;
  const result = {
    seasonal: data.seasonal?.media  || [],
    trending: data.trending?.media  || [],
    popular:  data.popular?.media   || [],
    top:      data.top?.media       || [],
    upcoming: data.upcoming?.media  || []
  };

  // Cache for 10 minutes — home data doesn't change that fast
  cache.set(cacheKey, result, 600);
  return result;
}

module.exports = { fetchAnime, searchAnime, fetchRecentlyAired, fetchHome };