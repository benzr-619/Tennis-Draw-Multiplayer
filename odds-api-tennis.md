# The Odds API — Tennis Reference (v4)

Source: https://the-odds-api.com/sports/tennis-odds.html

---

## Grand Slam Sport Keys

Use these as the `sport` parameter in `/v4/sports/{sport}/odds`.

| Tournament            | Sport Key                      |
|-----------------------|--------------------------------|
| ATP Australian Open   | `tennis_atp_aus_open_singles`  |
| ATP French Open       | `tennis_atp_french_open`       |
| ATP Wimbledon         | `tennis_atp_wimbledon`         |
| ATP US Open           | `tennis_atp_us_open`           |
| WTA Australian Open   | `tennis_wta_aus_open_singles`  |
| WTA French Open       | `tennis_wta_french_open`       |
| WTA Wimbledon         | `tennis_wta_wimbledon`         |
| WTA US Open           | `tennis_wta_us_open`           |

> ⚠️ The Australian Open keys use the `_singles` suffix. All other Grand Slams do not.

---

## Player Name Format in h2h Outcomes

Names are **full names** — `"First Last"` — no abbreviation, no last-name-only.

Example from the docs (ATP French Open, h2h market):

```json
"outcomes": [
  { "name": "Ethan Quinn", "price": 4.6 },
  { "name": "Tallon Griekspoor", "price": 1.21 }
]
```

Match/compare player names using full name strings. Treat as case-sensitive.

---

## Example Request

```
https://api.the-odds-api.com/v4/sports/tennis_atp_french_open/odds?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=YOUR_API_KEY
```

Data is only returned when the tournament is **in season**.
