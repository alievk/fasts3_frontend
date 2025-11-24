cd "$(dirname "$0")"
aws s3 cp ../.env s3://torrent-downloader-stockholm/env/.env_frontend
