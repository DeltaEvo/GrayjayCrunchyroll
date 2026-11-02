//#region constants
const PLATFORM = "Crunchyroll";
const BASE_URL = "https://www.crunchyroll.com";
const PREMIUM_URL = "https://www.crunchyroll.com/premium";
const AUTH_TOKEN_URL = "https://www.crunchyroll.com/auth/v1/token";
const SERIES_URL_PREFIX = "https://www.crunchyroll.com/series/";
const WIDEVINE_LICENSE_URL = "https://cr-license-proxy.prd.crunchyrollsvc.com/v1/license/widevine?specConform=true";
const USER_PROFILE_API_URL = "https://www.crunchyroll.com/accounts/v1/me/profile";

const EXPLORE_URL_TEMPLATE = "https://www.crunchyroll.com/content/v2/discover/browse?{query}";
const LOCALE_URL_TEMPLATE = "https://www.crunchyroll.com/f/v1/home?locale={locale}";
const EPISODE_URL_TEMPLATE = "https://www.crunchyroll.com/watch/{episode_id}/{episode_slug_title}";
const SEARCH_TEMPLATE_URL = "https://www.crunchyroll.com/content/v2/discover/search?{queryString}";
const OBJECT_WITH_RATINGS_URL_TEMPLATE = "https://www.crunchyroll.com/content/v2/cms/objects/{objectId}?ratings=true&{queryString}";
const OBJECT_SERIE_SEASONS_URL_TEMPLATE = "https://www.crunchyroll.com/content/v2/cms/series/{seriesId}/seasons?{queryString}";
const OBJECT_SEASON_EPISODES_URL_TEMPLATE = "https://www.crunchyroll.com/content/v2/cms/seasons/{seasonId}/episodes?{queryString}";
const VIDEO_SKIP_EVENTS_URL_TEMPLATE = "https://static.crunchyroll.com/skip-events/production/{videoId}.json";
const ACCOUNT_INFO_URL_PLACEHOLDER = "https://www.crunchyroll.com/content/v2/{account_id}/custom-lists?{queryString}";
const SUBSCRIPTIONS_URL_PLACEHOLDER = "https://www.crunchyroll.com/content/v2/{account_id}/custom-lists/{list_id}?{queryString}";
const PLAY_URL_TEMPLATE = "https://cr-play-service.prd.crunchyrollsvc.com/v1/{video_id}/web/firefox/play";

const CONTENT_DETAIL_REGEX = /^https:\/\/www\.crunchyroll\.com\/(?:[a-z]{2}-[a-z]{2}\/)?watch\/([A-Z0-9]+)(?:\/.*)?$/;
const SERIES_REGEX = /https?:\/\/www\.crunchyroll\.com\/(?:[a-z]{2}-[a-z]{2}\/)?series\/([A-Z0-9]+)(?:\/|$)/;
const REGEX_INTERNAL_PLAYLIST_URL = /^https:\/\/grayjay\.internal\/Crunchyroll\/playlist\/([A-Z0-9]+)(?:\?.*)?$/;

const ITEMS_PER_PAGE = 100;
// const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0" as const
// set missing constants
Type.Order.Chronological = "Latest releases";
Type.Order.Views = "Most played";
Type.Order.Favorites = "Most favorited";
Type.Feed.Playlists = "PLAYLISTS";
Type.Feed.Albums = "ALBUMS";
let local_settings = {
    premiumContentUnavailableIndex: 0,
    localeIndex: 0,
    preferredAudioLanguageOptionIndex: 0,
    subtitlesLanguageOptionIndex: 0
};
/** State */

let local_state = {
    headers: {},
    channels: {},
    isPremium: false,
    accountId: '',
    is_anonymous_session: true,
    deviceId: generateUUIDv4()
};

// Desktop builds without Widevine can browse but never play, so keep the plugin off there
const IS_HLS_WIDEVINE_AVAILABLE = (bridge.supportedFeatures ?? []).indexOf("HLSWidevineSource") >= 0;

const runtime_requirements = [
    bridge.buildPlatform === "android" || (bridge.buildPlatform === "desktop" && IS_HLS_WIDEVINE_AVAILABLE)
]

// Desktop: Cloudflare rejects the default HTTP client's TLS fingerprint; use curl-impersonate
const http_client = (bridge.buildPlatform === "desktop" && typeof httpimp !== "undefined") ? httpimp : http;

let config = {};
let UNAVAILABLE_OPTIONS = [];
let PREFERED_AUDIO_LANGUAGE_OPTIONS_VALUES = {};
let PREFERED_AUDIO_LANGUAGE_OPTIONS_KEYS = [];
let LOCALE_OPTIONS = [];
let SUBTITLE_OPTIONS = [];
//#endregion
//#region source methods
const local_source = {
    enable,
    disable,
    saveState,
    getHome,
    getChannel,
    getChannelContents,
    getChannelPlaylists,
    search,
    searchChannels,
    getSearchCapabilities,
    isContentDetailsUrl,
    getContentDetails,
    getContentChapters,
    getContentRecommendations,
    isChannelUrl,
    isPlaylistUrl,
    getUserSubscriptions,
    getUserPlaylists,
};

init_source(local_source);

function init_source(local_source) {

    if (runtime_requirements?.length && !runtime_requirements?.every(Boolean)) {
        source.enable = () => {
        }

        source.getHome = () => {
            bridge.toast('Current platform is not supported yet.');
            return new ContentPager([], false);
        }
    } else {
        for (const method_key of Object.keys(local_source)) {
            source[method_key] = local_source[method_key];
        }
    }

}
//#endregion
//#region enable
function enable(conf, settings, saved_state) {
    config = conf;
    local_settings = settings;
    UNAVAILABLE_OPTIONS = loadOptionsForSetting("premiumContentUnavailableIndex");

    PREFERED_AUDIO_LANGUAGE_OPTIONS_VALUES = loadOptionsForSetting("preferredAudioLanguageOptionIndex")
        .filter(option => option !== "Original")
        .reduce((acc, option) => {
            const [langCode, langName] = option.split(" - ");
            acc[langCode] = { langCode, langName };
            return acc;
        }, {});

    LOCALE_OPTIONS = loadOptionsForSetting("localeIndex")
        .map(option => {
            const [langCode] = option.split(" - ");
            return langCode;
        });

    SUBTITLE_OPTIONS = loadOptionsForSetting("subtitlesLanguageOptionIndex")
        .filter(option => option !== "None")
        .map(option => {
            const [langCode] = option.split(" - ");
            return langCode;
        });

    PREFERED_AUDIO_LANGUAGE_OPTIONS_KEYS = Object.keys(PREFERED_AUDIO_LANGUAGE_OPTIONS_VALUES);

    if (IS_TESTING) {
        local_settings.premiumContentUnavailableIndex = 0; // As regular content
        local_settings.preferredAudioLanguageOptionIndex = 0; // Original
    }

    if (saved_state) {
        local_state = JSON.parse(saved_state);
    }

    getHeaders();

    //set settings
    savePreferences();


}
//#endregion
function disable() {
    log("Crunchyroll log: disabling");
}
function saveState() {
    return JSON.stringify(local_state);
}
//#region home

function getHome() {
    class HomeContentVideoPager extends VideoPager {
        constructor(
            {
                videos = [],
                hasMore = true,
                context = { offset: 0 },
            } = {}
        ) {
            super(videos, hasMore, context);
        }

        nextPage() {

            const local_settings = getLocalizationSettings();
            const start = this.context.offset || 0;
            const isFirstPage = start === 0;

            const query = objectToUrlEncodedString({
                ...local_settings,
                type: "episode",
                n: ITEMS_PER_PAGE,
                start,
                sort_by: "newly_added",
                ratings: true,
            });

            let batchRequests = http_client.batch();
            batchRequests.GET(replaceUrlPlaceholders(EXPLORE_URL_TEMPLATE, { query }), getHeaders());

            if (isFirstPage) {
                batchRequests.GET(replaceUrlPlaceholders(LOCALE_URL_TEMPLATE, { locale: local_settings.locale }), getHeaders(), true);
            }

            const responses = batchRequests.execute();

            if (!responses[0].isOk) {
                throw new ScriptException(`Failed to fetch discover page. Status: ${responses[0].code}`);
            }

            const discoverBody = JSON.parse(responses[0].body);

            let allEpisodes = [];
            if (isFirstPage && !local_state.isPremium) {
                const homeResponse = responses[1];
                if (!homeResponse.isOk) {
                    throw new ScriptException(`Failed to fetch home page. Status: ${homeResponse.code}`);
                }

                const homeBody = JSON.parse(homeResponse.body);
                const freeToWatchUrls = this.extractFreeToWatchUrls(homeBody);
                const freeToWatchResponses = this.fetchFreeToWatchContent(freeToWatchUrls);

                const recommendations = this.extractRecommendations(freeToWatchResponses);
                allEpisodes = this.fetchEpisodesByIds(recommendations);
            }

            const preferedAudioLanguage = getPreferredAudioLanguage();

            const platformVideos =
                filterEpisodesByLanguage([...allEpisodes, ...discoverBody.data], preferedAudioLanguage)
                    .map(e => episodeToPlatformVideo(e))
                    .filter(Boolean);

            const offset = this.context.offset + ITEMS_PER_PAGE;

            return new HomeContentVideoPager({
                context: { offset },
                videos: platformVideos,
                hasMore: offset < discoverBody.total,
            });
        }

        /**
         * Extracts unique free-to-watch URLs from the provided homeBody object
         * @param {Object} homeBody - The homeBody object containing children with link properties
         * @returns {Set<string>} A Set of unique free-to-watch URLs
         */
        extractFreeToWatchUrls(homeBody) {
            // Early return if homeBody or homeBody.children is null/undefined
            if (!homeBody?.children) {
                return new Set();
            }

            // Extract generic free/sampler URLs
            const freeToWatch = homeBody.children
                .filter(item => {
                    // Check if analyticsId exists before calling toLowerCase()
                    const analyticsId = item?.props?.analyticsId;
                    return analyticsId &&
                        (analyticsId.toLowerCase().includes("sampler") ||
                            analyticsId.toLowerCase().includes("free")) &&
                        item.props.link;
                })
                .map(item => item.props.link);

            // Extract specific first seasons URL
            const freeToWatchFirstSeasonsUrl = homeBody.children.find(
                item => item?.props?.analyticsId === "Curation_Collections/Editorial/Free-to-Watch_First_Seasons"
            )?.props?.link || '';

            // Extract seasonal sampler URL
            const newEpisodesSeasonalSamplerUrl = homeBody.children.find(
                item => item?.props?.analyticsId && item.props.analyticsId.includes("_Seasonal_Sampler")
            )?.props?.link || '';

            // Combine all URLs and filter out empty strings
            const allUrls = [...freeToWatch, freeToWatchFirstSeasonsUrl, newEpisodesSeasonalSamplerUrl]
                .filter(Boolean);
            // Return a Set of unique URLs
            return new Set(allUrls);
        }

        fetchFreeToWatchContent(urlSet) {
            let freeToWatchBatchRequests = http_client.batch();

            urlSet.forEach(url => {
                freeToWatchBatchRequests.GET(`${BASE_URL}${url}`, getHeaders(), true);
            });

            return freeToWatchBatchRequests.execute();
        }

        extractRecommendations(freeToWatchResponses) {
            let recommendationsSet = new Set();

            freeToWatchResponses.forEach(response => {

                if (response.isOk) {
                    const freeToWatchBody = JSON.parse(response.body);
                    const freeToWatchEpisodes = freeToWatchBody?.recommendations?.map(i => i.contentItemId) ?? [];
                    freeToWatchEpisodes.forEach(id => recommendationsSet.add(id));
                } else {
                    bridge.log(JSON.stringify(response))
                }
            });

            return Array.from(recommendationsSet);
        }

        fetchEpisodesByIds(ids) {
            if (!ids.length) return [];

            const episodeResponse = http_client.GET(
                replaceUrlPlaceholders(OBJECT_WITH_RATINGS_URL_TEMPLATE, { objectId: ids.join(","), queryString: getLocationQueryString() }),
                getHeaders(),
                true
            );

            if (!episodeResponse.isOk) {
                throw new ScriptException("Failed to fetch episode details");
            }

            return JSON.parse(episodeResponse.body)?.data ?? [];
        }
    }

    return new HomeContentVideoPager().nextPage();

}

//#endregion
//#region search
function getSearchCapabilities() {
    return new ResultCapabilities([
        Type.Feed.Videos
    ], [], getLanguageFilterGroups());
}

// Search filters (fork): default-language shortcuts, search mode and per-language lists.
// Step 1: only exposes the filters; search results are not filtered yet.
function getLanguageFilterGroups() {
    const audioLang = getPreferredAudioLanguage();
    const subtitleLang = getPreferredSubtitleLanguage();
    const audioName = PREFERED_AUDIO_LANGUAGE_OPTIONS_VALUES?.[audioLang]?.langName ?? audioLang;
    const subtitleName = loadOptionsForSetting("subtitlesLanguageOptionIndex")
        .find((o) => o.startsWith(subtitleLang + " - "))?.split(" - ")[1] ?? subtitleLang;

    // Grayjay shows the 3rd FilterCapability argument as the label, so it repeats the name
    const languageOptions = (prefix) => loadOptionsForSetting("preferredAudioLanguageOptionIndex")
        .map((option) => {
            const [langCode, langName] = option.split(" - ");
            return new FilterCapability(`${langName} (${langCode})`, langCode, `${langName} (${langCode})`);
        });

    return [
        new FilterGroup("Idioma padrão", [
            new FilterCapability(`Áudio em ${audioName}`, "audio", `Áudio em ${audioName}`),
            new FilterCapability(`Legenda em ${subtitleName}`, "subtitle", `Legenda em ${subtitleName}`),
        ], true, "defaultLang"),
        new FilterGroup("Buscar por", [
            new FilterCapability("Mídia (episódio)", "media", "Mídia (episódio)"),
            new FilterCapability("Criador (série)", "creator", "Criador (série)"),
        ], false, "mode"),
        new FilterGroup("Áudio (dublagem)", languageOptions("audio"), true, "audio"),
        new FilterGroup("Legenda", languageOptions("subtitle"), true, "subtitle"),
    ];
}

function search(query, type, order, filters) {
    log(query, order, filters, type);
    type = 'episode';
    return genericSearch(query, type, order, filters);
}

function searchChannels(query, type, order, filters) {
    log(query, order, filters, type);
    type = 'series';
    return genericSearch(query, type, order, filters);
}

function getChannel(url) {
    const seriesId = extractSeriesId(url);
    if (!seriesId) {
        throw new ScriptException("Invalid channel URL");
    }

    if (local_state.channels[seriesId]) {
        return local_state.channels[seriesId];
    }

    const channel = getObjectMetadata(seriesId, { first: true });
    const thumbnails = channel?.images?.poster_tall?.[0] ?? [{ source: '' }];
    const banners = channel?.images?.poster_wide?.[0] ?? [{ source: '' }];
    local_state.channels[seriesId] = new PlatformChannel({
        id: new PlatformID(PLATFORM, seriesId, plugin.config.id),
        name: channel.title,
        thumbnail: thumbnails[thumbnails.length - 1].source, //TODO: add setting to select thumbnail quality
        banner: banners[banners.length - 1].source, //TODO: add setting to select thumbnail quality
        subscribers: 0,
        description: channel?.description ?? '',
        url,
        // links
    });

    return local_state.channels[seriesId];
}
function getChannelContents(url) {

    const seriesId = extractSeriesId(url);

    if (!seriesId) {
        throw new ScriptException("Invalid channel URL");
    }


    const seasonsResponse = http_client
        .GET(replaceUrlPlaceholders(OBJECT_SERIE_SEASONS_URL_TEMPLATE, { seriesId: seriesId, queryString: objectToUrlEncodedString(getLocalizationSettings()) }), getHeaders(), true);

    if (!seasonsResponse.isOk) {
        throw new ScriptException(`Failed to fetch serie season: ${seasonsResponse.code}`);
    }

    const seasonIdList = JSON.parse(seasonsResponse.body)?.data?.toReversed()?.map(e => e.id) ?? [];

    class ChannelContentVideoPager extends VideoPager {
        constructor(
            {
                videos = [],
                hasMore = true,
                context = { offset: 0, seasonIdList: [] },
            }
        ) {
            super(videos, hasMore, context);

        }

        nextPage() {

            const platformVideos = getSeasonEpisodes(this.context.seasonIdList[this.context.offset], { isPlaylist: false })?.toReversed() ?? [];

            const offset = this.context.offset + 1;

            return new ChannelContentVideoPager({
                context: { offset, seasonIdList: this.context.seasonIdList },
                videos: platformVideos,
                hasMore: offset < this.context.seasonIdList.length,
            });
        }
    }

    return new ChannelContentVideoPager({ context: { seasonIdList: seasonIdList, offset: 0 } }).nextPage();

}

function getChannelPlaylists(url) {

    const seriesId = extractSeriesId(url);

    if (!seriesId) {
        throw new ScriptException("Invalid channel URL");
    }

    const [serieInfoResponse, seasonsResponse] = http_client
        .batch()
        .GET(replaceUrlPlaceholders(OBJECT_WITH_RATINGS_URL_TEMPLATE, { objectId: seriesId, queryString: getLocationQueryString() }), getHeaders(), false)
        .GET(replaceUrlPlaceholders(OBJECT_SERIE_SEASONS_URL_TEMPLATE, { seriesId: seriesId, queryString: objectToUrlEncodedString(getLocalizationSettings()) }), getHeaders(), true)
        .execute();

    if (!serieInfoResponse.isOk) {
        throw new ScriptException("Failed to fetch serie info");
    }

    if (!seasonsResponse.isOk) {
        throw new ScriptException("Failed to fetch serie season");
    }

    const seasons = JSON.parse(seasonsResponse.body)?.data?.toReversed() ?? [];
    const serieInfo = JSON.parse(serieInfoResponse.body)?.data[0] ?? {};
    const thumbnails = serieInfo?.images?.poster_wide?.[0] ?? [{ source: '' }];

    const serieTitle = serieInfo.title;

    let contentList = [];

    seasons.forEach((season) => {

        const name = `Season ${season.season_number} - ${season.title}`;

        const params = objectToUrlEncodedString({
            name,
            serieTitle,
            serieUrl: url,
            seriesId
        });

        const playlistUrl = `https://grayjay.internal/${PLATFORM}/playlist/${season.id}?${params}`;

        const content = new PlatformPlaylist({
            id: new PlatformID(PLATFORM, season.series_id, plugin.config.id),
            author: new PlatformAuthorLink(
                new PlatformID(PLATFORM, seriesId, plugin.config.id),
                serieTitle,
                url
            ),
            name,
            thumbnail: thumbnails[thumbnails.length - 1].source,
            videoCount: season.number_of_episodes,
            datetime: 0,
            url: playlistUrl,
        });

        contentList.push(content);

    });

    return new ContentPager(contentList, false);

}

function getSeasonEpisodes(seasonId, opts = { isPlaylist: true, filterCb: null }) {

    if (!opts.filterCb) {
        opts.filterCb = () => true;
    }

    const seasonEpisodes = http_client.GET(replaceUrlPlaceholders(OBJECT_SEASON_EPISODES_URL_TEMPLATE, { seasonId, queryString: objectToUrlEncodedString(getLocalizationSettings()) }), getHeaders(), true);

    if (!seasonEpisodes.isOk) {
        throw new ScriptException("Failed to fetch season episodes");
    }

    const episodes = JSON.parse(seasonEpisodes.body)?.data ?? [];

    return episodes
        .filter(opts.filterCb)
        .map(e => episodeToPlatformVideo(e, opts))
        .filter(Boolean);
}

source.getPlaylist = function (url) {

    if (!url) {
        throw new ScriptException(`Invalid playlist URL: ${url}`);
    }

    if (url.startsWith("crunchyroll:playlist")) {

        const playlistId = url.split(":")[2];

        const itemsPerPage = 10;

        const urlPaths = {
            'watchlist': 'discover/',
            'watch-history': '',
        }

        function getReqUrl(playlistId, start = 0) {
            return `https://www.crunchyroll.com/content/v2/${urlPaths[playlistId]}${local_state.accountId}/${playlistId}?order=desc&n=${itemsPerPage}&start=${start}&preferred_audio_language=ja-JP&locale=ja-JP`;
        }

        const reqUrl = getReqUrl(playlistId);


        const response = http_client.GET(reqUrl, getHeaders(), true);

        if (response.isOk) {

            let episodeIds = [];

            const data = JSON.parse(response.body);

            episodeIds = data.data.map(e => e.panel.id);

            const total = data.total;
            const pendingPages = Math.ceil(total / itemsPerPage) - 1;

            let batchRequests = http_client.batch();

            Array
                .from({ length: pendingPages }, (_, i) => {
                    return getReqUrl(playlistId, (i + 1) * itemsPerPage);
                })
                .forEach(url => {
                    batchRequests.GET(url, getHeaders(), true);
                });

            const responses = batchRequests.execute();

            responses
                .filter(r => r.isOk)
                .map(r => JSON.parse(r.body))
                .forEach(data => {
                    episodeIds = [...episodeIds, ...data.data.map(e => e.panel.id)];
                });

            const episodeListResponse = http_client.GET(
                replaceUrlPlaceholders(OBJECT_WITH_RATINGS_URL_TEMPLATE, { objectId: episodeIds.join(","), queryString: getLocationQueryString() }),
                getHeaders(),
                true
            );

            let contentList = [];

            if (episodeListResponse.isOk) {
                const episodes = JSON.parse(episodeListResponse.body)?.data ?? [];
                contentList = episodes.map(e => episodeToPlatformVideo(e, { isPlaylist: true })).filter(Boolean);
            }

            return new PlatformPlaylistDetails({
                url: '',
                id: new PlatformID(PLATFORM, '', config.id),
                author: new PlatformAuthorLink(
                    new PlatformID(PLATFORM, '', config.id),
                    '',// author name
                    '',// author url
                ),
                name: playlistId,// playlist name
                thumbnail: '',
                videoCount: contentList.length ?? 0,
                contents: new VideoPager(contentList),
                shareUrl: '',
            });

        }

    } else {
        const seasonId = extractSeasonId(url);

        if (!seasonId) {
            throw new ScriptException(`Invalid playlist URL: ${url}`);
        }

        const urlParams = new URLSearchParams(url.split('?')[1]);

        const name = urlParams.get('name');
        const serieTitle = urlParams.get('serieTitle') ?? '';
        const serieUrl = urlParams.get('serieUrl') ?? '';
        const seriesId = urlParams.get('seriesId') ?? '';


        const seasonEpisodes = getSeasonEpisodes(seasonId);

        return new PlatformPlaylistDetails({
            url: '',
            id: new PlatformID(PLATFORM, '', config.id),
            author: new PlatformAuthorLink(
                new PlatformID(PLATFORM, seriesId, config.id),
                serieTitle,// author name
                serieUrl,// author url
            ),
            name: name,// playlist name
            thumbnail: '',
            videoCount: seasonEpisodes.length ?? 0,
            contents: new VideoPager(seasonEpisodes),
            shareUrl: '',
        });
    }

};

//#endregion
//#region content
function isContentDetailsUrl(url) {
    return CONTENT_DETAIL_REGEX.test(url);
}

function getContentRecommendations(url, nextEpisodeResponseInitialData) {
    let nextEpisodeResponse;

    if (!nextEpisodeResponseInitialData) {
        return new ContentPager([], false);
    }

    nextEpisodeResponse = nextEpisodeResponseInitialData;

    const nextEpisode = (JSON.parse(nextEpisodeResponse.body)?.data ?? [])
        .map(episodeToPlatformVideo)
        .filter(Boolean);

    if (!nextEpisode?.length) {
        return new ContentPager([], false);
    }

    return new ContentPager(nextEpisode, false);
}

function getContentChapters(url) {

    const videoId = url.match(CONTENT_DETAIL_REGEX)?.[1];

    const response = http_client.GET(replaceUrlPlaceholders(VIDEO_SKIP_EVENTS_URL_TEMPLATE, { videoId }), {}, false);

    if (!response.isOk) {
        throw new ScriptException("Failed to fetch content chapters");
    }

    const skipTypes = { intro: true, credits: true, preview: true };

    return Object.values(JSON.parse(response.body))
        .filter(skipEvent => typeof skipEvent === 'object')
        .sort((a, b) => a.start - b.start)
        .map(skipEvent => {
            return {
                name: skipEvent.type,
                timeStart: skipEvent.start,
                timeEnd: skipEvent.end,
                type: skipTypes[skipEvent.type] ? Type.Chapter.SKIPPABLE : Type.Chapter.NORMAL,
            }
        });
}

// TODO one thing to figure out will be how to link to other dubbings. they are different content ids (urls)
// i don't think grayjay current has good support for the kind of structure crunchyroll uses. i'm not sure what the best approach will be
//
// TODO it's very easy to fill up the "active streams" for a premium account. there is likely an api call that is made when a tab closes that signals that the stream has ended. we'll need to send that request
function getContentDetails(url) {
    const video_id = url.match(CONTENT_DETAIL_REGEX)?.[1];
    if (video_id === undefined) {
        throw new ScriptException("regex error");
    }
    const responses = http_client
        .batch()
        .GET(replaceUrlPlaceholders(OBJECT_WITH_RATINGS_URL_TEMPLATE, { objectId: video_id, queryString: getLocationQueryString() }), getHeaders(), false)
        .GET(replaceUrlPlaceholders(PLAY_URL_TEMPLATE, { video_id: video_id }), getHeaders(), false)
        .execute();
    if (responses[0] === undefined || responses[1] === undefined) {
        throw new ScriptException("unreachable");
    }
    if (!responses[0].isOk) {
        if (responses[0].code === 404) {
            throw new UnavailableException("This episode is not available");
        }
        throw new ScriptException(`Failed to fetch episode metadata. Status: ${responses[0].code}`);
    }
    const episode_response = JSON.parse(responses[0].body);
    const play_response = JSON.parse(responses[1].body);


    const metadata = episode_response.data[0];
    if (metadata === undefined) {
        throw new ScriptException("missing episode metadata");
    }

    if (metadata.episode_metadata.is_premium_only && bridge.isLoggedIn() === false) {
        throw new LoginRequiredException("Login with a premium account to watch");
    }
    if (!responses[1].isOk) {
        throw new ScriptException(`Failed to fetch play response: ${play_response.error}`);
    }

    const hardSubs = play_response?.hardSubs;

    let subsSources = [
        {
            hlang: play_response.audioLocale,
            url: play_response.url,
            priority: true
        },
    ];

    if (play_response?.hardSubs) {
        subsSources = [
            ...subsSources,
            ...Object.values(hardSubs).map(hardSub => {
                return {
                    hlang: hardSub.hlang,
                    url: hardSub.url,
                    isHardSub: true,
                    priority: false
                }
            })
        ];
    }

    const sources = subsSources.map(s => {

        const name = s.isHardSub ? `Hard Sub - ${s.hlang}` : s.hlang;
        return new DashWidevineSource({
            priority: !!s.priority,
            name: name,
            duration: metadata.episode_metadata.duration_ms / 1000,
            url: s.url,
            requestModifier: {
                // headers for the manifest
                headers: getHeaders(),
            },
            licenseUri: WIDEVINE_LICENSE_URL,
            getLicenseRequestExecutor: () => {
                return {
                    executeRequest: (url, _headers, _method, license_request_data) => {
                        if (license_request_data === null) {
                            throw new ScriptException("missing license request data");
                        }
                        const response = http_client.POST(url, license_request_data, {
                            ...getHeaders(),
                            "X-Cr-Content-Id": video_id,
                            "X-Cr-Video-Token": play_response.token,
                            "Content-Type": "application/octet-stream"
                        }, false, true);

                        if (!response.isOk || !response.body) {
                            throw new ScriptException("Failed to acquire license [" + response.code + "]");
                        }
                        return response.body;
                    }
                };
            }
        });
    });

    const alternateVersions = play_response.versions?.filter(v => v.guid !== video_id && (!v.is_premium_only || local_state.isPremium));

    if (alternateVersions?.length) {
        let alternateStreamsLabel = '<p>Alternate Streams dubs:</p>';

        alternateVersions.forEach((version) => {
            
            try {
                const versionUrl = `${BASE_URL}/watch/${version.guid}`;
                const langName = PREFERED_AUDIO_LANGUAGE_OPTIONS_VALUES[version.audio_locale]?.langName;
                const langAudioLocale = version?.audio_locale ?? "";
                const displayLang = [langName, langAudioLocale].filter(Boolean).join(' - ');
                alternateStreamsLabel += `<p><a href="${versionUrl}">${displayLang} ${version.original ? 'original' : 'dubbed'} version</a></p>`;
            } catch (error) {
                log(`failed to add alternate stream to description  [${version?.audio_locale ?? ""}]`);
                log(error);
            }
        });

        metadata.description += alternateStreamsLabel;
    }

    const serieUrl = `${SERIES_URL_PREFIX}${metadata.episode_metadata.series_id}/${metadata.episode_metadata.series_slug_title}`;

    const channel = getChannel(serieUrl);

    const { likes, dislikes } = parseLikesAndDislikes(metadata.rating);
    const images = metadata?.images?.thumbnail?.[0] ?? [];

    const season = metadata?.episode_metadata?.season_number ? `S${metadata.episode_metadata.season_number}` : '';

    const episodeNumber = metadata?.episode_metadata?.episode_number ? `E${metadata.episode_metadata.episode_number}` : '';

    let name = [
        `${season}${episodeNumber}`,
        metadata?.title
    ]
        .filter(Boolean)
        .join(' - ');

    const thumbnails = new Thumbnails(images.map((image) => new Thumbnail(image.source, image.height)));
    const result = new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, metadata.id, plugin.config.id),
        name,
        thumbnails: thumbnails,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, metadata.episode_metadata.series_id, plugin.config.id),
            metadata.episode_metadata.series_title,
            serieUrl,
            channel.thumbnail
        ),
        datetime: new Date(metadata.episode_metadata.upload_date).getTime() / 1000,
        url,
        duration: metadata.episode_metadata.duration_ms / 1000,
        isLive: false,
        shareUrl: url,
        description: metadata.description,
        video: new VideoSourceDescriptor(sources),
        subtitles: [
            ...Object.values(play_response?.subtitles ?? {}).map(subtitleInfo => ({
                name: subtitleInfo.language,
                url: subtitleInfo.url,
                format: "text/vtt",
                getSubtitles: () => {
                    const assSubtitleResponse = http_client.GET(subtitleInfo.url, {}, false);
                    if (assSubtitleResponse.isOk) {
                        return assToVtt(assSubtitleResponse.body);
                    }
                }
            })),
            ...Object.values(play_response?.captions ?? {}).map(captionInfo => ({
                name: captionInfo.language + ' (CC)',
                url: captionInfo.url,
                format: "text/vtt",
                getSubtitles: () => {
                    const captionResponse = http_client.GET(captionInfo.url, {}, false);
                    if (captionResponse.isOk) {
                        return captionResponse.body;
                    }
                }
            }))
        ],
        // TODO I'm not usre if total is the total interactions or the total upvotes
        // consider using the star rating instead of the like and dislike rating
        rating: new RatingLikesDislikes(likes, dislikes),
    });

    result.getContentChapters = function () {
        return source.getContentChapters(url);
    }

    // TODO add recommendations section (probably the "next episode" section)
    result.getContentRecommendations = function () {
        const seasonVideos = getSeasonEpisodes(metadata.episode_metadata.season_id, { isPlaylist: false, filterCb: (e) => e.episode_number > metadata.episode_metadata.episode_number }) ?? [];
        return new ContentPager(seasonVideos, false);
    };

    if (bridge.isLoggedIn()) {
        result.getPlaybackTracker = function () {
            return new CrunchyrollPlaybackTracker(local_state.accountId, video_id, play_response.token);
        };
    }

    return result;
}
//#endregion
//#region playlists
function isPlaylistUrl(url) {
    return isValidCrunchyrollSeasonUrl(url) || url.startsWith("crunchyroll:playlist");
}
//#endregion
//#region channel
/**
 * Checks if a given URL is a Crunchyroll series URL.
 *
 * @param {string} url - The URL to check.
 * @returns {boolean} - True if the URL is a series URL, false otherwise.
 */
function isChannelUrl(url) {
    return SERIES_REGEX.test(url);
}

function getLocationQueryString() {
    return objectToUrlEncodedString(getLocalizationSettings());
}

//#endregion
//#region other
function getUserSubscriptions() {

    const subscriptions = [];

    try {
        const response = http_client.GET(replaceUrlPlaceholders(ACCOUNT_INFO_URL_PLACEHOLDER, { account_id: local_state.accountId, queryString: getLocationQueryString() }), getHeaders(), true);

        if (response.isOk) {

            const listsIds = JSON.parse(response.body)?.data?.map(l => l.list_id) ?? [];

            if (listsIds.length) {
                const batchRequests = http_client.batch();

                listsIds.forEach(listId => {
                    batchRequests.GET(replaceUrlPlaceholders(SUBSCRIPTIONS_URL_PLACEHOLDER, { account_id: local_state.accountId, list_id: listId, queryString: getLocationQueryString() }), getHeaders(), true);
                });

                batchRequests
                    .execute()
                    .filter(r => r.isOk)
                    .map(r => JSON.parse(r.body))
                    .forEach(list => {
                        list.data.forEach(item => {
                            subscriptions.push(`${SERIES_URL_PREFIX}${item.id}/${item.panel.slug_title}`);
                        });
                    });
            }
        }
    } catch (e) {
        log(e);
        bridge.toast("Failed to fetch subscriptions");
    }

    return subscriptions;
}

function getUserPlaylists() {

    return [
        'crunchyroll:playlist:watchlist',
        'crunchyroll:playlist:watch-history',
    ]
}
//#endregion
//#region utilities
function genericSearch(query, type, order, filters) {

    class GenericSearchPager extends VideoPager {

        constructor({
            videos = [],
            hasMore = true,
            context = { start: null },
        } = {}) {
            super(videos, hasMore, context);
        }

        nextPage() {
            log(query, order, filters, type);
            const searchQuery = query.split(" ").join("+");

            const start = this?.context?.start;

            const queryString = objectToUrlEncodedString({
                ...getLocalizationSettings(),
                q: searchQuery,
                type,
                ratings: true,
                n: ITEMS_PER_PAGE,
                start
            });


            const response = http_client.GET(replaceUrlPlaceholders(SEARCH_TEMPLATE_URL, { queryString }), getHeaders(), true);

            const contentList = [];
            if (response.isOk) {
                const searchResults = JSON.parse(response.body)?.data ?? [];
                searchResults.forEach((searchResult) => {
                    // handle other types in the future
                    if (searchResult.type === "episode") {
                        searchResult.items
                            .forEach((metadata) => {
                                const content = episodeToPlatformVideo(metadata);
                                if (content) {
                                    contentList.push(content);
                                }
                            });
                    }

                    if (searchResult.type === "series") {
                        searchResult.items
                            .forEach((metadata) => {
                                contentList.push(serieToPlatformChannel(metadata));
                            });
                    }
                });
            }

            return new GenericSearchPager({
                videos: contentList,
                hasMore: contentList.length > 0,
                context: { start: start + ITEMS_PER_PAGE },
            });
        }
    }

    return new GenericSearchPager().nextPage();
}

function serieToPlatformChannel(serie) {

    const thumbnails = serie?.images?.poster_tall?.[0]?.map((image) => new Thumbnail(image.source, image.height)) ?? [];
    const url = `${SERIES_URL_PREFIX}${serie.id}/${serie.slug_title}`;

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, serie.id, plugin.config.id),
        name: serie.title,
        thumbnail: thumbnails[thumbnails.length - 1].url, //TODO: add setting to select thumbnail quality
        banner: '',
        subscribers: 0,
        description: serie?.description ?? '',
        url,
        // links
    });
}

function episodeToPlatformVideo(episode, opts = { isPlaylist: false }) {

    if (!episode.episode_metadata) {
        episode.episode_metadata = episode;
    }

    const t = episode?.images?.thumbnail?.[0]?.map((image) => new Thumbnail(image.source, image.height)) ?? [];
    const thumbnails = new Thumbnails(t);
    const url = replaceUrlPlaceholders(EPISODE_URL_TEMPLATE, { episode_id: episode.id, episode_slug_title: episode.slug_title });

    const availabilityStatus = episode?.episode_metadata?.availability_status;
    const isPremiumOnly = availabilityStatus === 'premium_only';
    const isUnavailable = availabilityStatus === 'unavailable';
    const isLoggedIn = bridge.isLoggedIn();
    const premiumContentUnavailableOption = UNAVAILABLE_OPTIONS[local_settings.premiumContentUnavailableIndex];

    const author = new PlatformAuthorLink(new PlatformID(PLATFORM, episode?.episode_metadata?.series_id, plugin.config.id), (episode.episode_metadata.series_title), `${SERIES_URL_PREFIX}${(episode.episode_metadata.series_id)}/${(episode.episode_metadata.series_slug_title)}`);
    const datetime = new Date(episode.episode_metadata.upload_date).getTime() / 1000;
    // The apps show a live item with a future date as planned
    const isPlanned = isUnavailable && datetime > Date.now() / 1000;
    const shouldShowContent = opts.isPlaylist || !isPremiumOnly || local_state.isPremium || premiumContentUnavailableOption === "As regular content";
    const durationInMs = episode?.episode_metadata?.duration_ms ?? 0;


    const premiumSuffix = isPremiumOnly && !local_state.isPremium ? ' (premium) - ' : '';

    const nameParts = [
        `S${episode.episode_metadata.season_number}` +
        (episode.episode_metadata.episode_number ? `E${episode.episode_metadata.episode_number}` : ''),
        `[${episode?.episode_metadata?.audio_locale?.toUpperCase() ?? ''}]`,
        premiumSuffix,
        episode.title
    ].filter(Boolean);

    const name = nameParts.join(' ');

    if (isUnavailable && !isPlanned && !opts.isPlaylist) {
        if (premiumContentUnavailableOption === "Hide") {
            return;
        }
        return new PlatformLockedContent({
            id: new PlatformID(PLATFORM, episode.id, plugin.config.id),
            name,
            author,
            datetime,
            lockDescription: 'This episode is not available',
            unlockUrl: "",
        });
    }
    else if (shouldShowContent) {
        return new PlatformVideo({
            id: new PlatformID(PLATFORM, episode.id, plugin.config.id),
            name,
            thumbnails: thumbnails,
            author,
            datetime,
            url,
            duration: durationInMs ? durationInMs / 1000 : 0,
            isLive: isPlanned,
            shareUrl: url
        });
    }
    else if (premiumContentUnavailableOption === "As locked Content") {
        const lockDescription = isLoggedIn ? 'This content is only available to premium users' : 'Login with a premium account to watch';
        const unlockUrl = isLoggedIn ? PREMIUM_URL : "";
        return new PlatformLockedContent({
            id: new PlatformID(PLATFORM, episode.id, plugin.config.id),
            name,
            author,
            datetime,
            lockDescription,
            unlockUrl,
        });
    }
}

function string_to_bytes(str) {
    const result = [];
    for (let i = 0; i < str.length; i++) {
        result.push(str.charCodeAt(i));
    }
    return new Uint8Array(result);
}
function loadOptionsForSetting(settingKey) {
    return config?.settings?.find((s) => s.variable == settingKey)
        ?.options ?? [];
}
/**
 * Extracts the series ID from a Crunchyroll series URL.
 *
 * @param {string} url - The Crunchyroll series URL.
 * @returns {string | null} - The extracted series ID or null if not found.
 */
function extractSeriesId(url) {
    const match = url.match(SERIES_REGEX);
    return match ? match[1] : null;
}
function getObjectMetadata(id, options = { first: false }) {
    const response = http_client.GET(replaceUrlPlaceholders(OBJECT_WITH_RATINGS_URL_TEMPLATE, { objectId: id, queryString: getLocationQueryString() }), getHeaders(), false);
    if (!response.isOk) {
        throw new ScriptException(`Failed to fetch metadata for content with ID ${id}`);
    }
    const data = JSON.parse(response.body)?.data ?? [];
    if (data.length && options.first) {
        return data[0];
    }
    return data;
}
function isValidCrunchyrollSeasonUrl(url) {
    return REGEX_INTERNAL_PLAYLIST_URL.test(url);
}
function extractSeasonId(url) {
    const match = url.match(REGEX_INTERNAL_PLAYLIST_URL);
    return match ? match[1] : null;
}
function objectToUrlEncodedString(obj) {
    const encodedParams = [];

    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const encodedKey = encodeURIComponent(key);
            const value = obj[key];

            if (value !== undefined && value !== null) {
                const encodedValue = encodeURIComponent(value);
                encodedParams.push(`${encodedKey}=${encodedValue}`);
            }

        }
    }

    return encodedParams.join('&');
}

function parseLikesAndDislikes(data) {
    // Helper function to convert displayed values with units to actual numbers
    function convertToNumber(displayed, unit) {
        let value = parseFloat(displayed); // Parse the number part
        switch (unit.toUpperCase()) { // Handle different unit cases
            case 'K':
                value *= 1000;
                break;
            case 'M':
                value *= 1000000;
                break;
            case 'B':
                value *= 1000000000;
                break;
            // No unit or unrecognized unit: assume value is already in base form
        }
        return value;
    }

    // Convert up (likes) and down (dislikes) using the helper
    const likes = convertToNumber(data.up.displayed, data.up.unit);
    const dislikes = convertToNumber(data.down.displayed, data.down.unit);

    // Return the processed object
    return {
        likes: likes,
        dislikes: dislikes
    };
}

function assToVtt(assContent) {

    function convertTime(assTime) {
        const [hours, minutes, seconds] = assTime.split(':');
        const [sec, millis] = seconds.split('.');
        const millisStr = millis ? millis.padEnd(3, '0') : '000'; // Default to 000 if no milliseconds
        return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${sec.padStart(2, '0')}.${millisStr}`;
    }

    const vttLines = ["WEBVTT\n\n"];

    assContent
        .split(/\r?\n/)
        .filter(l => /^Dialogue:/.exec(l))
        .forEach(line => {
            const parts = line.split(',');

            // Ensure the line has at least 10 parts (in case there are missing fields)
            if (parts.length >= 10) {
                const startTime = convertTime(parts[1]);
                const endTime = convertTime(parts[2]);
                let text = parts.slice(9).join(',').replace(/\\N/g, '\n'); // Handle newlines

                vttLines.push(`${startTime} --> ${endTime}`);
                vttLines.push(text);
                vttLines.push(''); // Blank line between captions
            }
        })

    return vttLines.join('\n');
}

function get_bearer() {

    // Request BASE_URL - logged in users will be redirected to /discover
    // Note: Crunchyroll may return 404 status with valid HTML content (soft 404)
    const res = http_client.GET(BASE_URL, {
        'User-Agent': config.authentication.userAgent
    }, true);

    // Check if we have a response body, even if status is 404
    if (!res.body) {
        throw new ScriptException(`Failed to fetch html. Status: ${res.code} ${res.url}. No response body.`);
    }

    // Updated regex to be more flexible with the accountAuthClientId pattern
    const match_result = res.body.match(/"accountAuthClientId":"([_a-z0-9]+)"/);
    if (match_result === null || match_result[1] === undefined) {
        throw new ScriptException(`Failed to extract accountAuthClientId from page. Status: ${res.code}, URL: ${res.url}. Crunchyroll may have changed their page structure.`);
    }
    const accountAuthClientId = match_result[1];
    const auth = utility.toBase64(string_to_bytes(`${accountAuthClientId}:`));
    // TODO the bearer token likely needs to be refreshed after some amount of time
    // here is an example for Spotify if that's helpful
    // https://gitlab.futo.org/videostreaming/plugins/spotify/-/blob/master/src/SpotifyScript.ts?ref_type=heads#L255

    let response;

    if (bridge.isLoggedIn()) {

        const body = objectToUrlEncodedString({
            device_id: local_state.deviceId,
            device_type: 'Firefox on Windows',
            grant_type: 'etp_rt_cookie'
        });

        const authRes = http_client.POST(AUTH_TOKEN_URL, body, {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }, true);

        if (!authRes.isOk) {
            bridge.toast(authRes.body);
            throw new ScriptException(`Failed to fetch auth token. Status: ${authRes.code}`);
        }

        response = JSON.parse(authRes.body);
        // 5 minutes before the token expires
    }
    else {

        const unauthRes = http_client.POST(AUTH_TOKEN_URL, "grant_type=client_id", {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Etp-Anonymous-Id": "6ba29c34-469b-4597-9d0d-9bbc672fb2d7"
        }, true);

        if (!unauthRes.isOk) {
            throw new ScriptException(`Failed to fetch auth token. Status: ${unauthRes.code}`);
        }

        response = JSON.parse(unauthRes.body);
        // 1h before the token expires
    }

    return {
        access_token: response.access_token,
        access_token_expires_at: Date.now() + response.expires_in * 1000
    };
}

function renewSession() {
    const { access_token, access_token_expires_at } = get_bearer();

    if (!access_token) {
        throw new LoginRequiredException("Failed to renew session");
    }

    local_state.access_token_expires_at = access_token_expires_at;
    local_state.headers = {
        Authorization: `Bearer ${access_token}`,
        'User-Agent': config.authentication.userAgent
    };

    if (bridge.isLoggedIn()) {

        const { payload } = decodeJWT(access_token);

        local_state.isPremium = payload.benefits.some(benefit => benefit === 'cr_premium');
        local_state.concurrentStreams = payload.benefits.find(benefit => benefit.startsWith('concurrent_streams'))?.split('.').pop();
        local_state.accountId = payload.etp_user_id;

    }

    local_state.is_anonymous_session = !bridge.isLoggedIn();
}

function getHeaders() {

    const validAuthSession = local_state.access_token_expires_at > Date.now();
    const isLoggedIn = bridge.isLoggedIn();

    // Renew session if:
    // 1. Token is expired
    // 2. User logged in (anonymous -> authenticated)
    // 3. User logged out (authenticated -> anonymous)
    const loginStateChanged = local_state.is_anonymous_session !== !isLoggedIn;

    if (!validAuthSession || loginStateChanged) {
        renewSession();
    }

    local_state.headers['User-Agent'] = config.authentication.userAgent;

    return local_state.headers;
}
function getPreferredAudioLanguage() {
    return PREFERED_AUDIO_LANGUAGE_OPTIONS_KEYS[local_settings.preferredAudioLanguageOptionIndex];
}

function getPreferredSubtitleLanguage() {
    return local_settings.subtitlesLanguageOptionIndex ? SUBTITLE_OPTIONS[local_settings.subtitlesLanguageOptionIndex] : "en-US";
}

function getPreferedLocale() {
    return local_settings.localeIndex ? LOCALE_OPTIONS[local_settings.localeIndex] : "en-US";
}

function decodeJWT(token) {
    // Validate token format
    if (!token || typeof token !== 'string') {
        throw new ScriptException('Invalid token: Must be a non-empty string');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new ScriptException('Invalid JWT: Must have exactly 3 parts');
    }

    const base64UrlToBase64 = (base64Url) => {
        return base64Url
            .replace(/-/g, '+')
            .replace(/_/g, '/') +
            '='.repeat((4 - (base64Url.length % 4)) % 4);
    };

    const decodeBase64 = (base64) => {
        try {
            return JSON.parse(atob(base64));
        } catch (error) {
            throw new ScriptException('Failed to decode Base64: Invalid format');
        }
    };

    try {
        const [header, payload, signature] = parts;

        return {
            header: decodeBase64(base64UrlToBase64(header)),
            payload: decodeBase64(base64UrlToBase64(payload)),
            signature: signature
        };
    } catch (error) {
        throw new ScriptException(`JWT Decoding Error: ${error.message}`);
    }
}


function replaceUrlPlaceholders(url, values) {
    // Guard against invalid inputs
    if (!url || typeof url !== 'string') {
        return '';
    }

    if (!values || typeof values !== 'object') {
        return url;
    }

    let newUrl = url;

    Object.keys(values).forEach((key) => {
        // Look for placeholders like {key}
        const placeholder = new RegExp(`\\{${key}\\}`, 'g');

        // Only replace if the value is defined
        if (values[key] !== undefined && values[key] !== null) {
            // Convert to string and encode URI components to prevent injection
            // const safeValue = encodeURIComponent(String(values[key]));
            const safeValue = String(values[key]);
            newUrl = newUrl.replace(placeholder, safeValue);
        }
    });

    // Validate the resulting URL structure
    try {
        new URL(newUrl); // This will throw if the URL is invalid
        return newUrl;
    } catch (error) {
        // If resulting URL is invalid, return original or empty string
        console.warn('Generated URL is invalid:', newUrl);
        return url.includes('://') ? url : '';
    }
}

function getLocalizationSettings() {
    // using same setting for know;
    return {
        locale: getPreferedLocale(),
        preferred_audio_language: getPreferredAudioLanguage(),
        force_locale: getPreferredAudioLanguage()
    }
}

function generateUUIDv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}


/**
 * Filters episodes to keep preferred language version when available, with fallback support
 * @param {Array<Object>} episodes - Array of episode objects with metadata
 * @param {string} preferredLanguage - User's preferred language code (e.g., 'pt-PT')
 * @returns {Array<Object>} Filtered episodes array
 */
function filterEpisodesByLanguage(episodes, preferredLanguage) {
    // Validate preferred language format
    if (!preferredLanguage.match(/^[a-z]{2}-[A-Z]{2}$/)) {
        throw new Error('Invalid language code format. Expected format: xx-XX (e.g., pt-PT)');
    }

    // Get base language for fallback (e.g., 'pt' from 'pt-PT')
    const baseLanguage = preferredLanguage.split('-')[0];

    // Create a Map to group episodes by their identifier
    const episodeGroups = new Map();

    // Group episodes by their identifier
    for (const episode of episodes) {
        const id = episode.episode_metadata?.identifier;
        const language = episode.episode_metadata?.audio_locale;

        // Skip episodes with invalid metadata
        if (!id || !language) {
            console.warn('Episode missing required metadata (identifier or audio_locale)', episode);
            continue;
        }

        if (!episodeGroups.has(id)) {
            episodeGroups.set(id, []);
        }
        episodeGroups.get(id).push(episode);
    }

    // Filter the episodes based on language preference with fallback
    const filteredEpisodes = [];
    for (const group of episodeGroups.values()) {
        if (group.length === 1) {
            // If only one language version exists, keep it
            filteredEpisodes.push(group[0]);
        } else {
            // First, try to find exact language match
            let selectedVersion = group.find(
                ep => ep.episode_metadata?.audio_locale === preferredLanguage
            );

            // If exact match not found, try to find a version with same base language
            if (!selectedVersion) {
                selectedVersion = group.find(ep => {
                    const episodeBaseLanguage = ep.episode_metadata?.audio_locale.split('-')[0];
                    return episodeBaseLanguage === baseLanguage;
                });
            }

            // If no preferred or fallback version found, use first version
            filteredEpisodes.push(selectedVersion || group[0]);
        }
    }

    return filteredEpisodes;
}

function savePreferences() {
    if (bridge.isLoggedIn()) {
        try {

            let batch = http_client.batch();

            [
                { "preferred_content_audio_language": getPreferredAudioLanguage() },
                { "preferred_content_subtitle_language": getPreferredSubtitleLanguage() },
                { "do_not_sell": true },
            ].forEach(requestBody => {
                batch = batch.requestWithBody(
                    'PATCH',
                    USER_PROFILE_API_URL,
                    JSON.stringify(requestBody),
                    { ...getHeaders(), 'Content-Type': 'application/json' },
                    true,
                )
            });

            const responses = batch.execute();

            if (IS_TESTING) {
                log(`
                    Response successful:
                    preferred_content_audio_language: ${responses[0].isOk}
                    preferred_content_subtitle_language: ${responses[1].isOk}
                    do_not_sell: ${responses[2].isOk}`);
            }

        } catch (e) {
            log(e);
            log('failed to set preferences')
        }
    }
}

class CrunchyrollPlaybackTracker extends PlaybackTracker {

    constructor(account_id, video_id, play_response_token) {
        super(30000);
        this.video_id = video_id;
        this.play_response_token = play_response_token;
        this.account_id = account_id;
    }

    onInit(seconds) {
    }

    onProgress(seconds, isPlaying) {
        if (bridge.isLoggedIn()) {

            if (seconds) {

                const headers = {
                    ...getHeaders(),
                    'Content-Type': 'application/json'
                };

                http_client.POST(
                    `https://www.crunchyroll.com/content/v2/${this.account_id}/playheads?preferred_audio_language=${getPreferredAudioLanguage()}&locale=${getPreferedLocale()}`,
                    JSON.stringify({ "content_id": this.video_id, "playhead": seconds }),
                    headers,
                    true
                );
            }
        }
    }

    onConcluded() {
        if (bridge.isLoggedIn()) {
            const deleteActiveStream = http_client.request('DELETE', `https://www.crunchyroll.com/playback/v1/token/${this.video_id}/${this.play_response_token}`, getHeaders(), false);

            if (!deleteActiveStream.isOk) {
                bridge.toast(`Failed to delete active stream: ${deleteActiveStream.error}`);
            }
        }

    }
}

//#endregion