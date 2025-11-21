# About

## en

Search and download movies from BitTorrent net.

## ru

Бот для поиска и скачивания фильмов.

-

Быстрое скачивание файлов через S3

# Description

## en

Hi! I’m a bot for searching and downloading movies.

I can:
- search for movies on major Torrent trackers (RuTracker, Rutor, Kinozal, NoNameClub)
- download movies on any device using a direct link
- online streaming, AirPlay
- no VPN required in Russia ✨

## ru

Привет! Я бот для поиска и скачивания фильмов. 

Вот, что я умею:
- поиск фильмов на крупнейших трекерах (Rutracker, Rutor, Kinozal, NoNameClub)
- быстрое скачивание фильмов по прямой ссылке на любое устройство
- онлайн стриминг, AirPlay
- работаю без VPN ✨

-

Привет! Я бот для поиска и скачивания файлов.

Вот, что я умею:
- поиск файлов на крупнейших площадках
- быстрое скачивание файлов по прямой ссылке на любое устройство
- работаю без VPN ✨

# Local translation prompt

create a copy of [bot.json](src/locales/bot.json) :
- keep only ru locale
- replace wording: avoid word "фильм". instead, use "файл"; remove inherent properties like "качество", "имя режиссера" etc
- replace emojiis associated with movies
- place json next to [bot.json](src/locales/bot.json) and call it bot_fake.json