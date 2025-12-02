### Endpoint format

```js
/api/search/<TITLE/ID>/<PROVIDER/ALL>
```

**Method** only: `GET`

### Header parametres

| Name       | Mandatory | Type  | Description                                                                                                                                                                    |
| -          | -         | -     | -                                                                                                                                                                              |
| `query`    | True*     | *str* | Movie or TV series title to *search by title* in the path parameter, or identifier to *search by ID*. Cyrillic characters are supported. You can use spaces if the query is in quotation marks, or use the symbol `+` instead of a space. |
| `page`     | False     | *int* | Page number from which the response will be received (`0 to 20`).                                                                                                              |
| `year`     | False     | *int* | Year of release of the film or TV series for filtering (supported only by the provider **Kinozal**).                                                                           |

### Provider List

Get a list of available providers:

🔹 `curl -s http://localhost:8443/api/provider/list`

```json
[
  {
    "Provider": "RuTracker",
    "Urls": [
      "https://rutracker.org",
      "https://rutracker.net",
      "https://rutracker.nl"
    ]
  },
  {
    "Provider": "Kinozal",
    "Urls": [
      "https://kinozal.tv",
      "https://kinozal.me",
      "https://kinozal.guru"
    ]
  },
  {
    "Provider": "RuTor",
    "Urls": [
      "https://rutor.info",
      "https://rutor.is"
    ]
  },
  {
    "Provider": "NoNameClub",
    "Urls": [
      "https://nnmclub.to"
    ]
  }
]
```

Quick check of provider availability:

🔹 `curl -s http://localhost:8443/api/provider/check`

```json
[
  {
    "RuTracker": true,
    "Kinozal": true,
    "RuTor": true,
    "NoNameClub": true
  }
]
```

### RSS feed

#### RuTracker

🔹 `curl -s -X GET http://localhost:8443/api/get/rss/rutracker -H 'accept: application/json'`

```json
[
  {
    "id": "tag:rto.feed,2024-08-14:/t/6562254",
    "link": "https://rutracker.org/forum/viewtopic.php?t=6562254",
    "updated": "2024-08-14T08:16:30+00:00",
    "title": "Долгий день уходит в ночь / Long Day's Journey Into Night (Сидни Люмет / Sidney Lumet) [1962, США, драма, BDRemux 1080p] [GBR Transfer] MVO (НТВ+) + Sub Eng + Original Eng [38.87 GB]",
    "author": "Bloomsbury",
    "category": "f-2198",
    "categoryLable": "HD Video"
  },
  {
    "id": "tag:rto.feed,2024-08-14:/t/6562249",
    "link": "https://rutracker.org/forum/viewtopic.php?t=6562249",
    "updated": "2024-08-14T08:14:40+00:00",
    "title": "Оклахома / Rodgers and Hammerstein's Oklahoma! (Тревор Нанн / Trevor Nunn) [1999, musical, мюзикл, вестерн, мелодрама, HDRip-AVC] MVO + Original Eng + Sub Rus, Eng [4.18 GB]",
    "author": "Bartimeyse",
    "category": "f-702",
    "categoryLable": "Опера, Оперетта и Мюзикл (Видео)"
  },
...
]
```

#### Kinozal

🔹 `curl -s -X GET http://localhost:8443/api/get/rss/kinozal -H 'accept: application/json'`

```json
[
  {
    "title": "Уцелевший (Боевой конь) / Warhorse One / 2023 / ПМ / WEB-DLRip",
    "link": "https://kinozal.tv/details.php?id=1984064",
    "category": "6",
    "guid": "https://kinozal.tv/details.php?id=1984064",
    "pubDate": "Wed, 14 Aug 2024 11:57:36 +0300"
  },
  {
    "title": "Губка Боб - Квадратные Штаны (9 сезон: 1-26 серии из 26) / SpongeBob SquarePants /...",
    "link": "https://kinozal.tv/details.php?id=1979045",
    "category": "21",
    "guid": "https://kinozal.tv/details.php?id=1979045",
    "pubDate": "Wed, 14 Aug 2024 11:50:44 +0300"
  },
...
]
```

#### RuTor

🔹 `curl -s -X GET http://localhost:8443/api/get/rss/rutor -H 'accept: application/json'`

```json
[
  {
    "date": "14 Авг 24",
    "title": "Русская жена [S01] (2022) WEBRip-AVC от Files-х",
    "link": "https://rutor.info/torrent/994998/russkaja-zhena-s01-2022-webrip-avc-ot-files-h",
    "downloadLink": "https:///d.rutor.info/download/994998",
    "magnet": "magnet:?xt=urn:btih:3a21beda484ddd86dc520e961ffaffcc0421bc02&dn=rutor.info&tr=udp://opentor.net:6969&tr=http://retracker.local/announce",
    "size": "10.33 GB",
    "comments": 0,
    "seeds": 20,
    "peers": 43
  },
  {
    "date": "14 Авг 24",
    "title": "Зверь внутри / The Beast Within (2024) WEB-DL 720p от селезень | L | RGB",
    "link": "https://rutor.info/torrent/997426/zver-vnutri_the-beast-within-2024-web-dl-720p-ot-selezen-l-rgb",
    "downloadLink": "https:///d.rutor.info/download/997426",
    "magnet": "magnet:?xt=urn:btih:939b5f0326458f839a81bab476cb38f9060ca00b&dn=rutor.info&tr=udp://opentor.net:6969&tr=http://retracker.local/announce",
    "size": "2.55 GB",
    "comments": 0,
    "seeds": 0,
    "peers": 0
  },
...
]
```

#### NoNameClub

🔹 `curl -s -X GET http://localhost:8443/api/get/rss/nonameclub -H 'accept: application/json'`

```json
[
  {
    "turbo": "true",
    "title": "Людям с расстройством сексуального поведения могут запретить водить машину",
    "link": "https://nnmclub.to/forum/viewtopic.php?t=1742015",
    "pubDate": "Thu, 15 Aug 2024 20:14:53 +0400",
    "description": "<a href=\"https://nnmclub.to/forum/viewtopic.php?t=1742015\" target=\"_blank\"><img itemprop=\"image\" itemborder=\"0\" width=\"256\" src=\"https://nnmstatic.win/forum/image.php?link=%2F%2Fi.ibb.co%2FWKXZ0yn%2Fimgec675c1de88562127ac08baa10a2c2f5.webp\" align=\"left\" style=\"margin-bottom:8px;margin-right:8px;\"></a><meta property=\"og:image\" content=\"https://i.ibb.co/WKXZ0yn/imgec675c1de88562127ac08baa10a2c2f5.webp\" />В России могут запретить водить машину людям с расстройством сексуального поведения. Проект распоряжения правительства, разработанный Минздравом, <span style=\"text-decoration: underline\">размещен</span> для общественного обсуждения.<br />Документом предусмотрен новый перечень заболеваний. Он представлен кодами по Международной классификации болезней 10-го пересмотра (МКБ-10). Так, в числе диагнозов значатся расстройства&nbsp;(<a href=\"https://nnmclub.to/forum/viewtopic.php?t=1742015\">   Читать дальше...   </a>)",
    "content": "&lt;a href=&quot;https://nnmclub.to/forum/viewtopic.php?t=1742015&quot; target=&quot;_blank&quot;&gt;&lt;img itemprop=&quot;image&quot; itemborder=&quot;0&quot; width=&quot;256&quot; src=&quot;https://nnmstatic.win/forum/image.php?link=%2F%2Fi.ibb.co%2FWKXZ0yn%2Fimgec675c1de88562127ac08baa10a2c2f5.webp&quot; align=&quot;left&quot; style=&quot;margin-bottom:8px;margin-right:8px;&quot;&gt;&lt;/a&gt;&lt;meta property=&quot;og:image&quot; content=&quot;https://i.ibb.co/WKXZ0yn/imgec675c1de88562127ac08baa10a2c2f5.webp&quot; /&gt;В России могут запретить водить машину людям с расстройством сексуального поведения. Проект распоряжения правительства, разработанный Минздравом, &lt;span style=&quot;text-decoration: underline&quot;&gt;размещен&lt;/span&gt; для общественного обсуждения.&lt;br /&gt;Документом предусмотрен новый перечень заболеваний. Он представлен кодами по Международной классификации болезней 10-го пересмотра (МКБ-10). Так, в числе диагнозов значатся расстройства&amp;nbsp;(&lt;a href=&quot;https://nnmclub.to/forum/viewtopic.php?t=1742015&quot;&gt;   Читать дальше...   &lt;/a&gt;)",
    "creator": "Romanukjr",
    "commentRss": "https://nnmclub.to/forum/rss.php?topic=1742015",
    "comments": "59"
  },
  {
    "turbo": "true",
    "title": "Огни рампы / Limelight (1952) BDRip [H.264/720p] [Platinum]",
    "link": "https://nnmclub.to/forum/viewtopic.php?t=1741805",
    "pubDate": "Thu, 15 Aug 2024 00:00:57 +0400",
    "description": "<a href=\"https://nnmclub.to/forum/viewtopic.php?t=1741805\" target=\"_blank\"><img itemprop=\"image\" itemborder=\"0\" width=\"256\" src=\"https://nnmstatic.win/forum/image.php?link=%2F%2Fi8.imageban.ru%2Fout%2F2024%2F08%2F08%2Fd154f774230cb7dc6dcdc84c322e3138.jpg\" align=\"left\" style=\"margin-bottom:8px;margin-right:8px;\"></a>Стареющий клоун Калверо спасает от самоубийства соседку, девушку-танцовщицу, вынужденную из-за болезни покинуть балетную труппу. Так начинается эта дружба-любовь, которая, по мнению Калверо, не может иметь продолжения - слишком велика разница в возрасте...<br /><br /><b>Производство</b>: США / Charles Chaplin Productions<br /><b>Жанр</b>: драма, мелодрама, музыка<br /><b>Режиссер</b>: Чарли Чаплин<br /><b>Актеры</b>: Чарли Чаплин, Клер Блум, Найджел Брюс, Бастер Китон, Сидни Чаплин, Норман Ллойд, Андре Эглевский, Мелисса Хейден, Марджори Беннетт, Вилер Драйден<br /><b>Перевод</b>: дублированный, профессиональный многоголосый, любительский одноголосый<br /><b>Язык озвучки</b>: русский, английский<br /><b>Субтитры</b>: русские, английские<br /><b>Продолжительность</b>: 02:17:51",
    "content": "&lt;a href=&quot;https://nnmclub.to/forum/viewtopic.php?t=1741805&quot; target=&quot;_blank&quot;&gt;&lt;img itemprop=&quot;image&quot; itemborder=&quot;0&quot; width=&quot;256&quot; src=&quot;https://nnmstatic.win/forum/image.php?link=%2F%2Fi8.imageban.ru%2Fout%2F2024%2F08%2F08%2Fd154f774230cb7dc6dcdc84c322e3138.jpg&quot; align=&quot;left&quot; style=&quot;margin-bottom:8px;margin-right:8px;&quot;&gt;&lt;/a&gt;Стареющий клоун Калверо спасает от самоубийства соседку, девушку-танцовщицу, вынужденную из-за болезни покинуть балетную труппу. Так начинается эта дружба-любовь, которая, по мнению Калверо, не может иметь продолжения - слишком велика разница в возрасте...&lt;br /&gt;&lt;br /&gt;&lt;b&gt;Производство&lt;/b&gt;: США / Charles Chaplin Productions&lt;br /&gt;&lt;b&gt;Жанр&lt;/b&gt;: драма, мелодрама, музыка&lt;br /&gt;&lt;b&gt;Режиссер&lt;/b&gt;: Чарли Чаплин&lt;br /&gt;&lt;b&gt;Актеры&lt;/b&gt;: Чарли Чаплин, Клер Блум, Найджел Брюс, Бастер Китон, Сидни Чаплин, Норман Ллойд, Андре Эглевский, Мелисса Хейден, Марджори Беннетт, Вилер Драйден&lt;br /&gt;&lt;b&gt;Перевод&lt;/b&gt;: дублированный, профессиональный многоголосый, любительский одноголосый&lt;br /&gt;&lt;b&gt;Язык озвучки&lt;/b&gt;: русский, английский&lt;br /&gt;&lt;b&gt;Субтитры&lt;/b&gt;: русские, английские&lt;br /&gt;&lt;b&gt;Продолжительность&lt;/b&gt;: 02:17:51",
    "creator": "msltel",
    "commentRss": "https://nnmclub.to/forum/rss.php?topic=1741805",
    "comments": "0",
    "enclosure": {
      "url": "https://nnmclub.to/forum/download.php?id=1334625",
      "length": "51218",
      "type": "application/x-bittorrent"
    }
  },
...
]
```

### Search by Title

#### Guaranteed Parameters for All Providers

| Parameter | Type | Description |
|-----------|------|-------------|
| `Name` | *str* | Full torrent name/title |
| `Id` | *str* | Provider-specific torrent ID |
| `Url` | *str* | Direct link to the torrent page |
| `Torrent` | *str* | Direct link to download the .torrent file |
| `Size` | *int* | File size in bytes |
| `Seeds` | *str* | Number of seeders |
| `Peers` | *str* | Number of leechers/peers |
| `Date` | *str* | Publication/update date (format varies by provider) |

#### All

🔹 `curl -s http://localhost:8443/api/search/title/all?query=Bo+Path+of+the+Teal+Lotus&page=0&year=0`

```json
{
  "RuTracker": [
    {
      "Name": "[DL] Bō (Bo): Path of the Teal Lotus [P] [ENG + 8] (2024, Arcade) (1.1.0) [Scene]",
      "Id": "6553038",
      "Url": "https://rutracker.net/forum/viewtopic.php?t=6553038",
      "Torrent": "https://rutracker.net/forum/dl.php?t=6553038",
      "Size": 5970108416,
      "Download_Count": "49",
      "Checked": "True",
      "Type": "Аркады",
      "Type_Link": "https://rutracker.net/forum/tracker.php?f=127",
      "Seeds": "3",
      "Peers": "0",
      "Date": "12.08.2024"
    },
    {
      "Name": "[DL] Bō (Bo): Path of the Teal Lotus [P] [RUS + ENG + 7] (2024, Arcade) (1.0.6) [P2P]",
      "Id": "6556973",
      "Url": "https://rutracker.net/forum/viewtopic.php?t=6556973",
      "Torrent": "https://rutracker.net/forum/dl.php?t=6556973",
      "Size": 1034289971,
      "Download_Count": "187",
      "Checked": "True",
      "Type": "Аркады",
      "Type_Link": "https://rutracker.net/forum/tracker.php?f=127",
      "Seeds": "7",
      "Peers": "1",
      "Date": "31.07.2024"
    },
    {
      "Name": "[Nintendo Switch] Bo: Path of the Teal Lotus [NSZ][ENG]",
      "Id": "6552174",
      "Url": "https://rutracker.net/forum/viewtopic.php?t=6552174",
      "Torrent": "https://rutracker.net/forum/dl.php?t=6552174",
      "Size": 839713587,
      "Download_Count": "727",
      "Checked": "True",
      "Type": "Switch",
      "Type_Link": "https://rutracker.net/forum/tracker.php?f=1605",
      "Seeds": "42",
      "Peers": "20",
      "Date": "17.07.2024"
    }
  ],
  "Kinozal": {
    "Result": "No matches were found for your title"
  },
  "RuTor": {
    "Result": "No matches were found for your title"
  },
  "NoNameClub": [
    {
      "Name": "Bo: Path of the Teal Lotus (2024) [Multi] (1.1.0) Repack FitGirl",
      "Id": "1742972",
      "Url": "https://nnmclub.to/forum/viewtopic.php?t=1742972",
      "Torrent": "https://nnmclub.to/forum/download.php?id=1335276",
      "Size": 989855744,
      "Comments": "0",
      "Type": "Горячие новинки Игр",
      "Seeds": "3",
      "Peers": "0",
      "Date": "14.08.2024 08:53"
    },
    {
      "Name": "Bo: Path of the Teal Lotus (2024) [Multi] (1.1.0) Scene Tenoke",
      "Id": "1739268",
      "Url": "https://nnmclub.to/forum/viewtopic.php?t=1739268",
      "Torrent": "https://nnmclub.to/forum/download.php?id=1333049",
      "Size": 5970108416,
      "Comments": "1",
      "Type": "Горячие новинки Игр",
      "Seeds": "2",
      "Peers": "1",
      "Date": "12.08.2024 18:06"
    },
    {
      "Name": "Bo: Path of the Teal Lotus (2024) [Ru/Multi] (1.0.6) Repack dixen18",
      "Id": "1740083",
      "Url": "https://nnmclub.to/forum/viewtopic.php?t=1740083",
      "Torrent": "https://nnmclub.to/forum/download.php?id=1333578",
      "Size": 1033895936,
      "Comments": "0",
      "Type": "Горячие новинки Игр",
      "Seeds": "2",
      "Peers": "0",
      "Date": "31.07.2024 12:55"
    }
  ]
}
```

#### RuTracker

🔹 `curl -s http://localhost:8443/api/search/title/rutracker?query=The+Rookie+2024&page=0&year=0`

```json
[
  {
    "Name": "Новичок / Новобранец / The Rookie / Сезон: 6 / Серии: 1-10 из 10 (Билл Роу, Майкл Гои) [2024, США, драма, комедия, криминал, WEB-DL 1080p] 3 x MVO (LostFilm, TVShows, HDrezka) + Original + Sub (Rus, Eng)",
    "Id": "6489949",
    "Url": "https://rutracker.net/forum/viewtopic.php?t=6489949",
    "Torrent": "https://rutracker.net/forum/dl.php?t=6489949",
    "Size": 35207471923,
    "Download_Count": "1307",
    "Checked": "True",
    "Type": "Сериалы США и Канады (HD Video)",
    "Type_Link": "https://rutracker.net/forum/tracker.php?f=266",
    "Seeds": "62",
    "Peers": "15",
    "Date": "26.06.2024"
  },
  {
    "Name": "Новичок / Новобранец / The Rookie / Сезон: 6 / Серии: 1-10 из 10 (Билл Роу) [2024, США, драма, комедия, криминал, WEB-DL 720p] MVO (LostFilm) + MVO (TVShows) + MVO (HDrezka) + Original + Sub (Rus, Eng)",
    "Id": "6498673",
    "Url": "https://rutracker.net/forum/viewtopic.php?t=6498673",
    "Torrent": "https://rutracker.net/forum/dl.php?t=6498673",
    "Size": 19685459294,
    "Download_Count": "1784",
    "Checked": "True",
    "Type": "Сериалы США и Канады (HD Video)",
    "Type_Link": "https://rutracker.net/forum/tracker.php?f=266",
    "Seeds": "30",
    "Peers": "12",
    "Date": "25.05.2024"
  },
  {
    "Name": "Новичок / Новобранец / The Rookie / Сезон: 6 / Серии: 1-10 из 10 (Билл Роу, Майкл Гои) [2024, США, боевик, драма, криминал, WEB-DLRip] MVO (LostFilm) + Original",
    "Id": "6489937",
    "Url": "https://rutracker.net/forum/viewtopic.php?t=6489937",
    "Torrent": "https://rutracker.net/forum/dl.php?t=6489937",
    "Size": 6390262374,
    "Download_Count": "3970",
    "Checked": "True",
    "Type": "Сериалы США и Канады",
    "Type_Link": "https://rutracker.net/forum/tracker.php?f=235",
    "Seeds": "107",
    "Peers": "42",
    "Date": "24.05.2024"
  },
  {
    "Name": "(Soundtrack, Rock) Новичок / Новобранец / The Rookie (Daddy Cop (From The TV Show \"The Rookie\")) (by Zander Hawley) - 2024 (2018), MP3 (tracks), 320 kbps",
    "Id": "6499482",
    "Url": "https://rutracker.net/forum/viewtopic.php?t=6499482",
    "Torrent": "https://rutracker.net/forum/dl.php?t=6499482",
    "Size": 5557453,
    "Download_Count": "54",
    "Checked": "True",
    "Type": "Саундтреки к сериалам (lossy)",
    "Type_Link": "https://rutracker.net/forum/tracker.php?f=1499",
    "Seeds": "3",
    "Peers": "0",
    "Date": "14.03.2024"
  }
]
```

#### Kinozal

🔹 `curl -s http://localhost:8443/api/search/title/kinozal?query=The+Rookie&page=0&year=2024`

```json
[
  {
    "Name": "Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108) / The Rookie / 2018-2024 / ПМ (LostFilm) / WEB-DLRip",
    "Title": "Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108)",
    "Id": "1953041",
    "Original_Name": "The Rookie",
    "Year": "2018-2024",
    "Language": "ПМ (LostFilm)",
    "Format": "WEB-DLRip",
    "Url": "https://kinozal.tv/details.php?id=1953041",
    "Torrent": "https://dl.kinozal.tv/download.php?id=1953041",
    "Size": 61888692429,
    "Comments": "2",
    "Seeds": "4",
    "Peers": "4",
    "Date": "14.08.2024 15:37"
  },
  {
    "Name": "Новичок (Новобранец) (6 сезон: 1-10 серии из 10) / The Rookie / 2024 / 3 x ПМ, СТ / WEB-DL (1080p)",
    "Title": "Новичок (Новобранец) (6 сезон: 1-10 серии из 10)",
    "Id": "2023066",
    "Original_Name": "The Rookie",
    "Year": "2024",
    "Language": "3 x ПМ, СТ",
    "Format": "WEB-DL (1080p)",
    "Url": "https://kinozal.tv/details.php?id=2023066",
    "Torrent": "https://dl.kinozal.tv/download.php?id=2023066",
    "Size": 35207471923,
    "Comments": "34",
    "Seeds": "15",
    "Peers": "4",
    "Date": "26.06.2024 01:17"
  },
  {
    "Name": "Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108) / The Rookie / 2018-2024 / ПМ (LostFilm) / WEB-DLRip (720p)",
    "Title": "Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108)",
    "Id": "2042752",
    "Original_Name": "The Rookie",
    "Year": "2018-2024",
    "Language": "ПМ (LostFilm)",
    "Format": "WEB-DLRip (720p)",
    "Url": "https://kinozal.tv/details.php?id=2042752",
    "Torrent": "https://dl.kinozal.tv/download.php?id=2042752",
    "Size": 164367097856,
    "Comments": "1",
    "Seeds": "2",
    "Peers": "4",
    "Date": "25.06.2024 09:30"
  },
  {
    "Name": "Новичок (Новобранец) (6 сезон: 1-10 серии из 10) / The Rookie / 2024 / 3 x ПМ, СТ / WEB-DL (720p)",
    "Title": "Новичок (Новобранец) (6 сезон: 1-10 серии из 10)",
    "Id": "2026484",
    "Original_Name": "The Rookie",
    "Year": "2024",
    "Language": "3 x ПМ, СТ",
    "Format": "WEB-DL (720p)",
    "Url": "https://kinozal.tv/details.php?id=2026484",
    "Torrent": "https://dl.kinozal.tv/download.php?id=2026484",
    "Size": 19685459294,
    "Comments": "4",
    "Seeds": "9",
    "Peers": "3",
    "Date": "25.05.2024 11:02"
  },
  {
    "Name": "Новичок (Новобранец) (6 сезон: 1-10 серии из 10) / The Rookie / 2024 / ПМ (LostFilm) / WEB-DLRip",
    "Title": "Новичок (Новобранец) (6 сезон: 1-10 серии из 10)",
    "Id": "2022944",
    "Original_Name": "The Rookie",
    "Year": "2024",
    "Language": "ПМ (LostFilm)",
    "Format": "WEB-DLRip",
    "Url": "https://kinozal.tv/details.php?id=2022944",
    "Torrent": "https://dl.kinozal.tv/download.php?id=2022944",
    "Size": 6390262374,
    "Comments": "22",
    "Seeds": "44",
    "Peers": "10",
    "Date": "24.05.2024 14:31"
  },
  {
    "Name": "Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108) / The Rookie / 2018-2024 / ПМ (LostFilm) / WEB-DLRip (1080p)",
    "Title": "Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108)",
    "Id": "1656552",
    "Original_Name": "The Rookie",
    "Year": "2018-2024",
    "Language": "ПМ (LostFilm)",
    "Format": "WEB-DLRip (1080p)",
    "Url": "https://kinozal.tv/details.php?id=1656552",
    "Torrent": "https://dl.kinozal.tv/download.php?id=1656552",
    "Size": 268020269465,
    "Comments": "148",
    "Seeds": "11",
    "Peers": "14",
    "Date": "24.05.2024 10:58"
  }
]
```

#### RuTor

🔹 `curl -s http://localhost:8443/api/search/title/rutor?query=The+Rookie+2024&page=0&year=0`

```json
[
  {
    "Name": "Новичок / Новобранец / The Rookie [S06] (2024) WEB-DL 720p | LostFilm, TVShows, HDrezka Studio",
    "Id": "986185",
    "Url": "https://rutor.info/torrent/986185/novichok_novobranec_the-rookie-s06-2024-web-dl-720p-lostfilm-tvshows-hdrezka-studio",
    "Torrent": "https://d.rutor.info/download/986185",
    "Hash": "6c3fa72ddc8f39afc7743f147e8ca3ee66ee99df",
    "Size": 19685459294,
    "Comments": "0",
    "Seeds": "7",
    "Peers": "2",
    "Date": "25.05.2024"
  },
  {
    "Name": "Новичок / Новобранец / The Rookie [S06] (2024) WEB-DLRip | LostFilm",
    "Id": "986139",
    "Url": "https://rutor.info/torrent/986139/novichok_novobranec_the-rookie-s06-2024-web-dlrip-lostfilm",
    "Torrent": "https://d.rutor.info/download/986139",
    "Hash": "3348d0a58dd8f5b251c7a361c9d235549260ba60",
    "Size": 6390262374,
    "Comments": "0",
    "Seeds": "27",
    "Peers": "16",
    "Date": "25.05.2024"
  },
  {
    "Name": "Новичок / Новобранец / The Rookie [S06] (2024) WEB-DL 1080p | LostFilm, TVShows, HDrezka Studio",
    "Id": "986138",
    "Url": "https://rutor.info/torrent/986138/novichok_novobranec_the-rookie-s06-2024-web-dl-1080p-lostfilm-tvshows-hdrezka-studio",
    "Torrent": "https://d.rutor.info/download/986138",
    "Hash": "2fdb28133eee0e3842ed855a08c07f35e482eedc",
    "Size": 35207471923,
    "Comments": "0",
    "Seeds": "25",
    "Peers": "8",
    "Date": "25.05.2024"
  }
]
```

#### NoNameClub

🔹 `curl -s http://localhost:8443/api/search/title/nonameclub?query=The+Rookie+2018&page=0&year=0`

```json
[
  {
    "Name": "Новичок / The Rookie (2018) WEB-DL [H.264/1080p-LQ] (сезон 1, серии 1-20 из 20) TVShows",
    "Id": "1259608",
    "Url": "https://nnmclub.to/forum/viewtopic.php?t=1259608",
    "Torrent": "https://nnmclub.to/forum/download.php?id=1018672",
    "Size": 54975581389,
    "Comments": "6",
    "Type": "Зарубежные сериалы",
    "Seeds": "1",
    "Peers": "1",
    "Date": "22.04.2019 12:09"
  },
  {
    "Name": "Новичок / The Rookie (2018) WEB-DL [H.264/1080p-LQ] (сезон 1, серии 1-20 из 20) LostFilm",
    "Id": "1278446",
    "Url": "https://nnmclub.to/forum/viewtopic.php?t=1278446",
    "Torrent": "https://nnmclub.to/forum/download.php?id=1030902",
    "Size": 56586618061,
    "Comments": "6",
    "Type": "Зарубежные сериалы",
    "Seeds": "1",
    "Peers": "0",
    "Date": "20.04.2019 03:30"
  },
  {
    "Name": "Новичок / The Rookie (2018) WEB-DLRip (сезон 1, серии 1-20 из 20) LostFilm",
    "Id": "1256703",
    "Url": "https://nnmclub.to/forum/viewtopic.php?t=1256703",
    "Torrent": "https://nnmclub.to/forum/download.php?id=1016767",
    "Size": 11274289152,
    "Comments": "31",
    "Type": "Зарубежные сериалы",
    "Seeds": "6",
    "Peers": "1",
    "Date": "19.04.2019 01:55"
  },
  {
    "Name": "Новобранец / The Rookie (2018) WEB-DLRip [H.264/720p] (сезон 1, серия 1-8 из 20) LostFilm (обновляемая)",
    "Id": "1265982",
    "Url": "https://nnmclub.to/forum/viewtopic.php?t=1265982",
    "Torrent": "https://nnmclub.to/forum/download.php?id=1022722",
    "Size": 10952754380,
    "Comments": "6",
    "Type": "Архив Сериалов и Архив Старого многосерийного кино до 90-х",
    "Seeds": "0",
    "Peers": "0",
    "Date": "22.12.2018 07:00"
  }
]
```

### Search by ID

#### RuTracker

🔹 `curl -s http://localhost:8443/api/search/id/rutracker?query=6489937`

```json
[
  {
    "Name": "Новичок / Новобранец / The Rookie / Сезон: 6 / Серии: 1-10 из 10 (Билл Роу, Майкл Гои) [2024, США, боевик, драма, криминал, WEB-DLRip] MVO (LostFilm) + Original",
    "Url": "https://rutracker.org/forum/viewtopic.php?t=6489937",
    "Hash": "3348D0A58DD8F5B251C7A361C9D235549260BA60",
    "Magnet": "magnet:?xt=urn:btih:3348D0A58DD8F5B251C7A361C9D235549260BA60&tr=http%3A%2F%2Fretracker.local%2Fannounce&tr=http%3A%2F%2Fbt.t-ru.org%2Fann&tr=http%3A%2F%2Fbt2.t-ru.org%2Fann&tr=http%3A%2F%2Fbt3.t-ru.org%2Fann&tr=http%3A%2F%2Fbt4.t-ru.org%2Fann",
    "Torrent": "https://rutracker.org/forum/dl.php?t=6489937",
    "IMDb_link": "https://www.imdb.com/title/tt7587890/",
    "Kinopoisk_link": "https://www.kinopoisk.ru/series/1142153/",
    "IMDb_id": "7587890",
    "Kinopoisk_id": "1142153",
    "Year": "2024",
    "Release": "США",
    "Type": "боевик, драма, криминал",
    "Duration": "00:43:00",
    "Audio": "Профессиональный (многоголосый закадровый) -",
    "Directer": "Билл Роу, Майкл Гои",
    "Actors": "Нэйтан Филлион, Мелисса О’Нил, Эрик Винтер, Дженна Деван, Шон Эшмор, Лиззет Чавез, Мекиа Кокс, Алисса Диас, Тру Валентино, Ричард Т. Джонс ,Бриджет Риган, Трой Кастанеда, Мэллори Томпсон, Алекс Элин Гойко, Констанс Эджума",
    "Description": "Начинать с чистого листа всегда нелегко, особенно для уроженца маленького городка Джона Нолана, который после перевернувшего его жизнь случая решил воплотить в жизнь давнюю мечту и вступить в ряды полиции Лос-Анджелеса. Возрастного новичка встречают с понятным скептицизмом, однако жизненный опыт, упорство и чувство юмора дают Джону преимущество.",
    "Quality": "WEB-DLRip",
    "Video": "XviD, 720x400 (16:9), 23.976 fps, 1600 Kbps",
    "Poster": "https://i123.fastpic.org/big/2024/0222/44/9c2349f7a7b72e0b0bbcd69f3bf27b44.jpg",
    "Files": [
      {
        "Name": "The.Rookie.S06E01.WEB-DLRip.RGzsRutracker.avi",
        "Size": 644093952
      },
      {
        "Name": "The.Rookie.S06E02.WEB-DLRip.RGzsRutracker.avi",
        "Size": 645470208
      },
      {
        "Name": "The.Rookie.S06E03.WEB-DLRip.RGzsRutracker.avi",
        "Size": 625664000
      },
      {
        "Name": "The.Rookie.S06E04.WEB-DLRip.RGzsRutracker.avi",
        "Size": 644755456
      },
      {
        "Name": "The.Rookie.S06E05.WEB-DLRip.RGzsRutracker.avi",
        "Size": 625551360
      },
      {
        "Name": "The.Rookie.S06E06.WEB-DLRip.RGzsRutracker.avi",
        "Size": 644759552
      },
      {
        "Name": "The.Rookie.S06E07.WEB-DLRip.RGzsRutracker.avi",
        "Size": 636594176
      },
      {
        "Name": "The.Rookie.S06E08.WEB-DLRip.RGzsRutracker.avi",
        "Size": 640335872
      },
      {
        "Name": "The.Rookie.S06E09.WEB-DLRip.RGzsRutracker.avi",
        "Size": 644085760
      },
      {
        "Name": "The.Rookie.S06E10.WEB-DLRip.RGzsRutracker.avi",
        "Size": 641015808
      }
    ]
  }
]
```

#### Kinozal

🔹 `curl -s http://localhost:8443/api/search/id/kinozal?query=2022944`

```json
[
  {
    "Name": "Новичок (Новобранец)",
    "Original_Name": "The Rookie",
    "Url": "https://kinozal.tv/details.php?id=2022944",
    "Hash": "3348D0A58DD8F5B251C7A361C9D235549260BA60",
    "Magnet": "magnet:?xt=urn:btih:3348D0A58DD8F5B251C7A361C9D235549260BA60&tr=http%3A%2F%2Fretracker.local%2Fannounce&tr=http%3A%2F%2Ftr0.torrent4me.com%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr1.torrent4me.com%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr2.torrent4me.com%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr3.torrent4me.com%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr4.torrent4me.com%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr5.torrent4me.com%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr0.tor4me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr1.tor4me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr2.tor4me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr3.tor4me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr4.tor4me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr5.tor4me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr0.tor2me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr1.tor2me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr2.tor2me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr3.tor2me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr4.tor2me.info%2Fann%3Fuk%3DkCm7WcIM00&tr=http%3A%2F%2Ftr5.tor2me.info%2Fann%3Fuk%3DkCm7WcIM00",
    "Torrent": "https://dl.kinozal.tv/download.php?id=2022944",
    "IMDb_link": "https://www.imdb.com/title/tt7587890/",
    "Kinopoisk_link": "https://www.kinopoisk.ru/film/1142153",
    "IMDB_id": "7587890",
    "Kinopoisk_id": "1142153",
    "Year": "2024",
    "Type": "Боевик, детектив, драма, криминал, полицейский, процедурал",
    "Release": "США, eOne Television, Perfectmon Pictures, ABC Studios",
    "Directer": "Тори Гаррет, Дэвид МакУиртер, Роберт Белла, Чери Ноулан, Джон Уэртас",
    "Actors": "Натан Филлион, Шон Эшмор, Эрик Винтер, Мелисса О`Нил, Алисса Диас, Ричард Т. Джонс, Мекиа Кокс, Тру Валентино, Эрджей Смит, Каноа Гу, Майкл Трукко, Пейтон Лист (I), Брент Хафф",
    "Description": "Начинать с чистого листа всегда нелегко, особенно для уроженца маленького городка Джона Нолана, который после инцидента, перевернувшего его жизнь, решил воплотить в жизнь давнюю мечту и присоединиться к полиции Лос-Анджелеса. Возрастного новичка встречают с понятным скептицизмом, однако жизненный опыт, упорство и чувство юмора дают Джону преимущество.",
    "Quality": "WEB-DLRip",
    "Video": "XviD, ~ 1600 Кбит/с, 720x400",
    "Audio": "Русский, английский (АС3, 2 ch, 192 Кбит/с)",
    "Size": 6390262374,
    "Duration": "10 x ~ 00:44:00",
    "Transcript": "Профессиональный многоголосый",
    "Seeds": "43",
    "Peers": "11",
    "Download_Count": "2113",
    "Files_Count": "10",
    "Comments": "22",
    "IMDb_Rating": "8.0",
    "Kinopoisk_Rating": "8.4",
    "Kinozal_Rating": "8.9",
    "Votes": "35",
    "Added_Date": "23 февраля 2024 в 00:46",
    "Update_Date": "24 мая 2024 в 14:31",
    "Poster": "https://kinozal.tv/i/poster/7/8/1655778.jpg",
    "Posters": [
      "https://fastpic.org/fullview/123/2024/0223/a85245e4e04e0de966819574d1532719.jpg",
      "https://fastpic.org/fullview/123/2024/0223/f3308f31fde2c78ac77bd976a0ad7066.jpg",
      "https://fastpic.org/fullview/123/2024/0223/99270276082060d8d267819594c880a2.jpg",
      "https://fastpic.org/fullview/123/2024/0223/5845be1a7d7392a18fb1bc343cb0c1fc.jpg",
      "https://fastpic.org/fullview/123/2024/0223/80aa1ffca3a4608a20f8bc63b214d587.jpg",
      "https://fastpic.org/fullview/123/2024/0223/84dfb0a8f5613813362539fa9eb800ac.jpg"
    ],
    "Files": [
      {
        "Name": "The.Rookie.S06E01.WEB-DLRip.RGzsRutracker.avi",
        "Size": 643825664
      },
      {
        "Name": "The.Rookie.S06E02.WEB-DLRip.RGzsRutracker.avi",
        "Size": 645922816
      },
      {
        "Name": "The.Rookie.S06E03.WEB-DLRip.RGzsRutracker.avi",
        "Size": 625999872
      },
      {
        "Name": "The.Rookie.S06E04.WEB-DLRip.RGzsRutracker.avi",
        "Size": 644874240
      },
      {
        "Name": "The.Rookie.S06E05.WEB-DLRip.RGzsRutracker.avi",
        "Size": 625999872
      },
      {
        "Name": "The.Rookie.S06E06.WEB-DLRip.RGzsRutracker.avi",
        "Size": 644874240
      },
      {
        "Name": "The.Rookie.S06E07.WEB-DLRip.RGzsRutracker.avi",
        "Size": 636485632
      },
      {
        "Name": "The.Rookie.S06E08.WEB-DLRip.RGzsRutracker.avi",
        "Size": 640679936
      },
      {
        "Name": "The.Rookie.S06E09.WEB-DLRip.RGzsRutracker.avi",
        "Size": 643825664
      },
      {
        "Name": "The.Rookie.S06E10.WEB-DLRip.RGzsRutracker.avi",
        "Size": 640679936
      }
    ]
  }
]
```

#### RuTor

🔹 `curl -s http://localhost:8443/api/search/id/rutor?query=986185`

```json
[
  {
    "Name": "Новичок / Новобранец / The Rookie [S06] (2024) WEB-DL 720p | LostFilm, TVShows, HDrezka Studio",
    "Url": "https://rutor.info/torrent/986185",
    "Hash": "6c3fa72ddc8f39afc7743f147e8ca3ee66ee99df",
    "Magnet": "magnet:?xt=urn:btih:6c3fa72ddc8f39afc7743f147e8ca3ee66ee99df&tr=http%3A%2F%2Fretracker.local%2Fannounce&tr=udp%3A%2F%2Fopentor.net%3A6969&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.grepler.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.bitsearch.to%3A1337%2Fannounce&tr=http%3A%2F%2Fh1.trakx.nibba.trade%3A80%2Fannounce&tr=http%3A%2F%2Fh2.trakx.nibba.trade%3A80%2Fannounce&tr=http%3A%2F%2Fh3.trakx.nibba.trade%3A80%2Fannounce&tr=http%3A%2F%2Fh4.trakx.nibba.trade%3A80%2Fannounce&tr=http%3A%2F%2Fh5.trakx.nibba.trade%3A80%2Fannounce",
    "Torrent": "https://d.rutor.info/download/986185",
    "IMDb_link": "http://www.imdb.com/title/tt7587890/",
    "Kinopoisk_link": "http://www.kinopoisk.ru/film/1142153/",
    "IMDb_id": "7587890",
    "Kinopoisk_id": "1142153",
    "Rating": "Никто ещё не поставил оценку",
    "Category": "Зарубежные сериалы",
    "Seeds": "3",
    "Peers": "2",
    "Seed_Date": "14-08-2024 8:19:07 (1 минуту назад)",
    "Add_Date": "25-05-2024 14:55:05  (3 месяца назад)",
    "Size": 19685459294,
    "Poster": "https://i123.fastpic.org/big/2024/0311/2f/5d19d67e60ba456eefdbbb59c5f4ce2f.png",
    "Files": [
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E01.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 2179940352
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E02.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 1986422374
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E03.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 2007903437
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E04.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 2040109465
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E05.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 1793126498
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E06.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 1782386483
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E07.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 2212164198
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E08.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 1793126498
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E09.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 1868322529
      },
      {
        "Name": "The.Rookie.S06.WEBDL.720p/The.Rookie.S06E10.WEBDL.720p.RGzsRutracker.mkv",
        "Size": 2029369450
      }
    ]
  }
]
```

#### NoNameClub

🔹 `curl -s http://localhost:8443/api/search/id/nonameclub?query=1259608`

```json
[
  {
    "Name": "Новичок / The Rookie (2018) WEB-DL [H.264/1080p-LQ] (сезон 1, серии 1-20 из 20) TVShows",
    "Url": "https://nnmclub.to/forum/viewtopic.php?t=1259608",
    "Hash": "C4E5F91AB1F8BBDF79B51C6E6167CFC806E2AA2B",
    "Magnet": "magnet:?xt=urn:btih:C4E5F91AB1F8BBDF79B51C6E6167CFC806E2AA2B&tr=http%3A%2F%2Fretracker.local%2Fannounce&tr=http%3A%2F%2Fbt01.nnm-club.info%3A2710%2Fannounce&tr=http%3A%2F%2Fbt02.nnm-club.info%3A2710%2Fannounce&tr=http%3A%2F%2Fbt01.nnm-club.cc%3A2710%2Fannounce&tr=http%3A%2F%2Fbt02.nnm-club.cc%3A2710%2Fannounce",
    "Torrent": "https://nnmclub.to/forum/download.php?id=1018672",
    "IMDb_link": "https://www.imdb.com/title/tt7587890/?ref_=plg_rt_1",
    "Kinopoisk_link": "https://www.kinopoisk.ru/film/1142153/",
    "IMDb_id": "75878901",
    "Kinopoisk_id": "1142153",
    "Release": "США / eOne Television, Perfectmon Pictures, ABC Studios",
    "Type": "драма",
    "Directer": "Грег Биман, Адам Дэвидсон, Тоа Фрейзер",
    "Actors": "Нэйтан Филлион, Алисса Диас, Титус Макин мл., Эрик Винтер, Ричард Т. Джонс, Мелисса О’Нил, Мерседес Масон, Эфтон Уильямсон, Марсей Монро, Дэвид ДеСантос и др.",
    "Description": "Начинать с чистого листа всегда нелегко, особенно для уроженца маленького городка Джона Нолана, который после инцидента, перевернувшего его жизнь, решил воплотить в жизнь давнюю мечту и присоединиться к полиции Лос-Анджелеса. Возрастного новичка встречают с понятным скептицизмом, однако жизненный опыт, упорство и чувство юмора дают Джону преимущество",
    "Duration": "00:43:00 серия",
    "Quality": "WEB-DL",
    "Video": "AVC/H.264, 1920x1080 (16:9), ~7024 kbps",
    "Audio": "Многоголосый закадровый, любительский (TVShows)",
    "Registration": "22 Апр 2019 12:09:12",
    "Rating": "4.6",
    "Votes": "59",
    "Size": 54975581389,
    "Poster": "https://nnmstatic.win/forum/image.php?link=https://b.radikal.ru/b11/1811/92/f4ed86b7965f.jpg",
    "Files": [
      {
        "Name": "The.Rookie.S01.1080p.TVShows",
        "Size": "Directory"
      },
      {
        "Name": "The.Rookie.S01E01.1080p.TVShows.mkv",
        "Size": 2598875914
      },
      {
        "Name": "The.Rookie.S01E02.1080p.TVShows.mkv",
        "Size": 2878062182
      },
      {
        "Name": "The.Rookie.S01E03.1080p.TVShows.mkv",
        "Size": 2802908856
      },
      {
        "Name": "The.Rookie.S01E04.1080p.TVShows.mkv",
        "Size": 2265922232
      },
      {
        "Name": "The.Rookie.S01E05.1080p.TVShows.mkv",
        "Size": 2319124889
      },
      {
        "Name": "The.Rookie.S01E06.1080p.TVShows.mkv",
        "Size": 2609615929
      },
      {
        "Name": "The.Rookie.S01E07.1080p.TVShows.mkv",
        "Size": 2394289561
      },
      {
        "Name": "The.Rookie.S01E08.1080p.TVShows.mkv",
        "Size": 1986422374
      },
      {
        "Name": "The.Rookie.S01E09.1080p.TVShows.mkv",
        "Size": 2179940352
      },
      {
        "Name": "The.Rookie.S01E10.1080p.TVShows.mkv",
        "Size": 3017624576
      },
      {
        "Name": "The.Rookie.S01E11.1080p.TVShows.mkv",
        "Size": 3221225472
      },
      {
        "Name": "The.Rookie.S01E12.1080p.TVShows.mkv",
        "Size": 2942470512
      },
      {
        "Name": "The.Rookie.S01E13.1080p.TVShows.mkv",
        "Size": 3092837801
      },
      {
        "Name": "The.Rookie.S01E14.1080p.TVShows.mkv",
        "Size": 3092837801
      },
      {
        "Name": "The.Rookie.S01E15.1080p.TVShows.mkv",
        "Size": 2878062182
      },
      {
        "Name": "The.Rookie.S01E16.1080p.TVShows.mkv",
        "Size": 3060621558
      },
      {
        "Name": "The.Rookie.S01E17.1080p.TVShows.mkv",
        "Size": 2878062182
      },
      {
        "Name": "The.Rookie.S01E18.1080p.TVShows.mkv",
        "Size": 2867322168
      },
      {
        "Name": "The.Rookie.S01E19.1080p.TVShows.mkv",
        "Size": 2963948527
      },
      {
        "Name": "The.Rookie.S01E20.1080p.TVShows.mkv",
        "Size": 2899102924
      }
    ]
  }
]
```

### Tests endpoints

Local testing of all endpoints:

🔹 `curl -s http://localhost:8443/api/provider/test?query=The+Rookie`

```json
[
  {
    "RSS": {
      "RuTracker": true,
      "Kinozal": true,
      "RuTor": true,
      "NoNameClub": true
    },
    "Title": {
      "Status": {
        "RuTracker": true,
        "Kinozal": true,
        "RuTor": true,
        "NoNameClub": true
      },
      "Id": {
        "RuTracker": 6489949,
        "Kinozal": 2023066,
        "RuTor": 986185,
        "NoNameClub": 1679153
      },
      "RunTime": {
        "RuTracker": 1.102,
        "Kinozal": 0.354,
        "RuTor": 0.98,
        "NoNameClub": 0.416
      }
    },
    "Id": {
      "Status": {
        "RuTracker": true,
        "Kinozal": true,
        "RuTor": true,
        "NoNameClub": true
      },
      "Files": {
        "RuTracker": true,
        "Kinozal": true,
        "RuTor": true,
        "NoNameClub": true
      },
      "RunTime": {
        "RuTracker": 0.678,
        "Kinozal": 1.083,
        "RuTor": 0.56,
        "NoNameClub": 1.217
      }
    }
  }
]
```

Building a Docker container image and testing endpoints via GitHub Actions:

```shell
--- Checking the availability of data on the server:

RuTracker data avaliable: false
Kinozal data avaliable: true
RuTor data avaliable: true
NoNameClub data avaliable: true

--- RSS:

----- RuTracker:
Status code: 200
Title: [Udemy] Optimising a mobile game in Unity [2023, ENG, LQ] [821.2 MB]
Url: https://rutracker.org/forum/viewtopic.php?t=6562325

----- Kinozal:
Status code: 200
Title: Sarah King - The Masquerade Is Over / Jazz / 2024 / Hi-Res / FLAC / Lossless
Url: https://kinozal.tv/details.php?id=20[489](https://github.com/Lifailon/TorAPI/actions/runs/10389495908/job/28767634074#step:6:490)31

----- RuTor:
Status code: 200
Title: Резидент / Chief of Station (2024) BDRemux 1080p | D
Url: https://rutor.info/torrent/997464/rezident_chief-of-station-2024-bdremux-1080p-d

----- NoNameClub:
Status code: 200
Title: Людям с расстройством сексуального поведения могут запретить водить машину
Url: https://nnmclub.to/forum/viewtopic.php?t=1742015

--- Search by Title:

Query: The+Rookie

----- RuTracker:
Response time (ms): 1100
Status code: 200
Check data: true
Id: 6489949
Url: https://rutracker.net/forum/viewtopic.php?t=6489949
Data: Новичок / Новобранец / The Rookie / Сезон: 6 / Серии: 1-10 из 10 (Билл Роу, Майкл Гои) [2024, США, драма, комедия, криминал, WEB-DL 1080p] 3 x MVO (LostFilm, TVShows, HDrezka) + Original + Sub (Rus, Eng)

----- Kinozal:
Response time (ms): 396
Status code: 200
Check data: true
Id: 1953041
Url: https://kinozal.tv/details.php?id=1953041
Data: Новичок (Новобранец) (1-6 сезоны: 1-108 серии из 108)

----- RuTor:
Response time (ms): 1038
Status code: 200
Check data: true
Id: 986185
Url: https://rutor.info/torrent/986185/novichok_novobranec_the-rookie-s06-2024-web-dl-720p-lostfilm-tvshows-hdrezka-studio
Data: Новичок / Новобранец / The Rookie [S06] (2024) WEB-DL 720p | LostFilm, TVShows, HDrezka Studio

----- NoNameClub:
Response time (ms): 1013
Status code: 200
Check data: true
Id: 1679153
Url: https://nnmclub.to/forum/viewtopic.php?t=1679153
Data: Агент Три нуля / Новички / Su ren te gong / The Rookies (2019) WEBRip [H.264/1080p]

--- Search by ID:

----- RuTracker:
Response time (ms): 852
Status code: 200
Check data: true
Data: Новичок / Новобранец / The Rookie / Сезон: 6 / Серии: 1-10 из 10 (Билл Роу, Майкл Гои) [2024, США, драма, комедия, криминал, WEB-DL 1080p] 3 x MVO (LostFilm, TVShows, HDrezka) + Original + Sub (Rus, Eng)
File: The.Rookie.S06E01.Strike.Back.1080p.AMZN.WEB-DL.H.264.RGzsRutracker.mkv
Size: 3639743526

----- Kinozal:
Response time (ms): 1052
Status code: 200
Check data: true
Data: Новичок (Новобранец)
File: 
Size: 

----- RuTor:
Response time (ms): 527
Status code: 200
Check data: true
Data: Новичок / Новобранец / The Rookie [S06] (2024) WEB-DL 720p | LostFilm, TVShows, HDrezka Studio
File: The.Rookie.S06.WEBDL.720p/The.Rookie.S06E01.WEBDL.720p.RGzsRutracker.mkv
Size: 2.03 GB

----- NoNameClub:
Response time (ms): 1[498](https://github.com/Lifailon/TorAPI/actions/runs/10389495908/job/28767634074#step:6:499)
Status code: 200
Check data: true
Data: Агент Три нуля / Новички / Su ren te gong / The Rookies (2019) WEBRip [H.264/1080p]
File: Agent.Tri.nulya.2019.WEB-DL.1080p.ELEKTRI4KA.UNIONGANG.mkv
Size: 5.49 GB
```

### Save torrent file

To save the torrent file on your computer, you can use one of the following constructs:

- **Linux** via `Bash`:

```bash
id=970650
url=$(curl -s "http://127.0.0.1:8443/api/search/id/rutor?query=$id" | jq -r .[].Torrent)
curl -s $url --output ~/downloads/$id.torrent
```

- **Windows** via `PowerShell`:

```PowerShell
$id = 970650
$url = $(Invoke-RestMethod "http://127.0.0.1:8443/api/search/id/rutor?query=$id").Torrent
Invoke-RestMethod $url -OutFile "$home\Downloads\$id.torrent"
```

- **Node.js** via `Axios`:

```js
const axios = require('axios')
const os = require('os')
const fs = require('fs')
const path = require('path')

const id = 970650
const url = `http://localhost:8443/api/search/id/rutor?query=${id}`
const homeDir = os.homedir()

axios.get(url).then(response => {
    const torrentUrl = response.data[0].Torrent
    return axios({
        url: torrentUrl,
        method: 'GET',
        responseType: 'stream'
    })
    }).then(response => {
        const filePath = path.join(homeDir, 'downloads', `${id}.torrent`)
        const writer = fs.createWriteStream(filePath)
        response.data.pipe(writer)
    })
```