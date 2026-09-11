# Confluent — icône de l'application

Marque retenue : « le confluent » — deux traits qui se rejoignent en une seule descente.
Dessin vectoriel fait à la main, à retoucher si besoin par un designer.

## Fichiers

| Fichier | Usage |
|---|---|
| `icon.svg` | Icône 1024×1024, fond vert inclus. Source pour l'icône iOS et le `icon` Expo. |
| `adaptive-icon-foreground.svg` | Android adaptive icon, calque avant (art dans la zone sûre de 264px). |
| `adaptive-icon-background.svg` | Android adaptive icon, calque arrière (aplat vert). |
| `icon-monochrome.svg` | Trait seul en `currentColor` — pour la barre d'onglets, Android 13 themed icon, favicon. |
| `splash.svg` | Écran de lancement, fond vert, marque centrée. |

## Couleurs

- Vert profond `#2E5A46` — fond de l'icône, couleur d'action de l'app
- Papier `#EFEBE4` — le trait
- Encre `#1B1A16` — texte
- Ocre `#C9662F` — accent secondaire, utilisé avec parcimonie

## Géométrie

Le tracé est défini dans une grille de 104×104 :

```
M22 14 V44 C22 58 40 60 52 70 C64 60 82 58 82 44 V14   (les deux bras)
M52 70 V92                                              (le tronc commun)
```

Épaisseur de trait 9 (soit ~8,6 % de la grille), extrémités et jointures arrondies.
Si tu redessines à une autre taille, garde ce ratio : en dessous de ~7 le trait casse à 38px,
au-dessus de ~11 les deux bras se referment.

## Intégration Expo

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": { "image": "./assets/splash.png", "resizeMode": "contain", "backgroundColor": "#2E5A46" },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon-foreground.png",
        "backgroundColor": "#2E5A46"
      }
    }
  }
}
```

Expo attend des PNG : exporter chaque SVG en PNG aux tailles attendues
(icon 1024×1024, adaptive foreground 432×432, splash 1284×2778) avec par exemple
`npx sharp-cli` ou `rsvg-convert`.
