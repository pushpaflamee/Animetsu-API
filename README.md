Anime API
Production-ready REST API that dynamically constructs Animetsu-style responses using AniList GraphQL as the data source and MongoDB as the internal mapping store.

Tech Stack
Layer
Technology
Runtime	Node.js 20 LTS
Framework	Express.js 4
Database	MongoDB 7 + Mongoose 8
Data Source	AniList GraphQL API
Cache	node-cache (in-memory)
Process Manager	PM2
Reverse Proxy	aaPanel / Nginx
Quick Start (Local)

# 1. Clone
git clone https://github.com/youruser/anime-api.git
cd anime-api

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env — set MONGODB_URI and INTERNAL_API_KEY

# 4. Run (dev)
npm run dev

# 5. Run (production)
npm start
Environment Variables
Variable
Required
Description
PORT	No	Server port (default: 3000)
MONGODB_URI	Yes	MongoDB connection string
INTERNAL_API_KEY	Yes	Secret key for private endpoints
ANILIST_API_URL	No	AniList GraphQL URL
CACHE_TTL_SECONDS	No	Cache TTL in seconds (default: 300)
Generate a secure key:


node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API Reference
Public Endpoints
GET /v2/api/anime/info/:id
Returns full Animetsu-style response for one anime.


curl https://yourdomain.com/v2/api/anime/info/6989b89d29cf95f4eb03b4d4
GET /v2/api/anime/search
Param
Type
Description
q	string	Search query (required)
page	number	Page number (default: 1)
per_page	number	Results per page (default: 20, max: 50)

curl "https://yourdomain.com/v2/api/anime/search?q=blue+lock&page=1&per_page=10"
GET /v2/api/anime/filter
Param
Type
Description
genre	string	e.g. Sports
year	number	e.g. 2024
format	string	TV, MOVIE, OVA, ONA
status	string	FINISHED, RELEASING
sort	string	popularity, year, score
page	number	Page number
per_page	number	Results per page

curl "https://yourdomain.com/v2/api/anime/filter?genre=Sports&year=2024&format=TV"
Private Endpoints
All private endpoints require the header:


x-api-key: <INTERNAL_API_KEY>
POST /v2/internal/anime/anilist/:anilist_id
Ingests an anime from AniList into the database.


curl -X POST https://yourdomain.com/v2/internal/anime/anilist/163146 \
  -H "x-api-key: your_key_here"
Response:


{ "message": "Ingested", "id": "6989b89d29cf95f4eb03b4d4", "anilist_id": 163146 }
DELETE /v2/internal/anime/:id
Removes an anime from the local database.

PUT /v2/internal/anime/refresh/:id
Force re-fetches and updates metadata from AniList.

Architecture

Request
  │
  ▼
Express Router
  │
  ▼
Controller  ──►  animeService (DB upsert / lookup)
  │                    │
  │              MongoDB (minimal metadata)
  │
  ▼
anilistProvider  ──►  AniList GraphQL API
  │                    (cached in node-cache)
  ▼
responseBuilder  ──►  Animetsu-style JSON response
Deployment (aaPanel VPS)
See the full step-by-step guide in the main API documentation or run:


# Install PM2
npm install -g pm2

# Start
pm2 start src/server.js --name anime-api
pm2 save && pm2 startup

# Monitor
pm2 status
pm2 logs anime-api
Future Endpoints (Stubs Ready)

GET /v2/api/anime/eps/:id         — Episode list
GET /v2/api/anime/servers/:ep_id  — Streaming servers
GET /v2/api/anime/sources/:ep_id  — Direct sources
License
MIT