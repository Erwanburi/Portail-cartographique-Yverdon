import './style.css';
import Overlay from 'ol/Overlay.js';
import { limitecommunale } from "./limite_communal.js";
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import WMTS from 'ol/source/WMTS.js';
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js';
import { optionsFromCapabilities } from 'ol/source/WMTS.js';
import { defaults as defaultControls } from 'ol/control.js';
import { defaults as defaultInteractions } from 'ol/interaction.js';
import proj4 from "proj4";
import { Projection } from "ol/proj";
import { register } from "ol/proj/proj4";
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Style from 'ol/style/Style.js';
import Stroke from 'ol/style/Stroke.js';
import Fill from 'ol/style/Fill.js';
import Draw from 'ol/interaction/Draw.js';
import { getArea } from 'ol/sphere.js';

// On définit le l'adresse du Backend flask --> utilisé pour les requêtes
const API = 'http://localhost:5000/api';

// Création des éléments de la "sidebar" -------------------------------------------------------------------------------------------------
// Il s'agit d'une fonction qui permet d'automatiser la création des éléments de la sidebar.
// Il prend en paramètre un layer (voir par la suite) exemp
function addLayerControl(layer, name) {
  const container = document.getElementById('layerControls'); //le container qui contient tous les wrapper pour chaque layer
  const wrapper = document.createElement('div'); // un wrapper par layer
  wrapper.style.marginBottom = '10px';

  const checkbox = document.createElement('input'); 
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  checkbox.addEventListener('change', () => layer.setVisible(checkbox.checked)); // pour afficher/désafficher une couche 

  const label = document.createElement('label'); //le nom de la couche qu'on veut afficher
  label.textContent      = name;
  label.style.marginLeft = '5px';

  const slider = document.createElement('input'); 
  slider.type = 'range';
  slider.min = 0;
  slider.max = 1;
  slider.step = 0.05;
  slider.value = layer.getOpacity();
  slider.style.marginLeft = '10px';
  slider.addEventListener('input', () => layer.setOpacity(parseFloat(slider.value))); //permet lorsqu'on bouge le slider, l'opacité de la couche change

  //on ajoute au wrapper tous les éléments donc la checkbox,label et le slider
  wrapper.appendChild(checkbox);
  wrapper.appendChild(label);
  wrapper.appendChild(slider);
  // on ajoute le wrapper avec tous "ses enfants" au gros container
  container.appendChild(wrapper);
}

// modifier le style pour les éléments sélectionnés -------------------------------------------------------------------------------------------------

const selected = new Style({
  stroke: new Stroke({ color: 'rgba(200,20,20,1)', width: 3 }),
  fill:   new Fill({   color: 'rgba(200,20,20,0.1)' }),
});

// code du cours pour définir la projection suisse -------------------------------------------------------------------------------------------------

const extent = [2535370, 1175881, 2543483, 1184357];
proj4.defs('EPSG:2056',
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
register(proj4);
const projection = new Projection({ code: "EPSG:2056", extent });


// Limite communale -------------------------------------------------------------------------------------------------
// C'est la seule couche qui est importé depuis un fichier directement copié collé de javascript (format geojson).
// C'est pour cela qu'il n'a pas besoin d'être à l'intérieur du fetch ci-dessous.
// Pour les autres "layer" c'est toujours un peu la même procédure : 
// on déclare un vectorsource qui contient les données --> ici geojson lu dans javascript
// On déclare un vectorLayer qui est définit par une source de donnée (donc la vectorsource) et un style (ici des bords bleu et
// et non rempli)

    const vectorSource_limite = new VectorSource({
      features: new GeoJSON().readFeatures(limitecommunale),
    });
    const vectorLayer_limite = new VectorLayer({
      source: vectorSource_limite,
      style: new Style({
        stroke: new Stroke({ color: 'rgba(0,0,255,1)', width: 2 }),
        fill: null,
      }),
    });

// Utilisation de donnée en ligne et via une base de donnée -------------------------------------------------------------------------------------------------
// Ici le fetch permet d'abord d'aller chercher une orthophoto en ligne via le lien ci-dessous. Puis, pour les parcelles, 
// on va les chercher via un fetch également qui est dirigé vers le backend flask. C'est dans ce backend que les calculs 
// sont réalisés et communique avec la base de donnée.

const parser = new WMTSCapabilities();

fetch('https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml?lang=fr', { // fetch pour l'orthophoto
  mode: 'cors',
  cache: 'no-cache'
})
  .then(r => r.text())
  .then(async text => {
    const caps = parser.read(text);

    // Orthophoto -------------------------------------------------------------------------------------------------

    const ortho = new TileLayer({
      source: new WMTS(optionsFromCapabilities(caps, {
        layer: 'ch.swisstopo.swissimage',
        matrixSet: 'EPSG:3857'
      })),
      opacity: 1
    });

    // Parcelles depuis Flask -------------------------------------------------------------------------------------------------
    // cette partie permet de créer le layer qui contient les parcelles. On le créer d'abord vide et on y applique un style.
   
    const vectorSource_parcelle = new VectorSource();
    const vectorLayer_parcelle  = new VectorLayer({
      source: vectorSource_parcelle,
      minZoom: 5, 
      style: new Style({
        stroke: new Stroke({ color: 'rgb(0, 217, 255)', width: 1.5 }),
        fill:   new Fill({   color: 'rgba(0, 217, 255, 0.05)' }),
      }),
    });

    // Ensuite, on va récupérer dans la variable "resp" et les transformer en geojson avec .json(). On récupère ensuite les 
    // données avec readFeatures puis on les ajoutes à vectorSource_parcelle crée vide préalablement.

    const resp = await fetch(`${API}/parcelles`); //fetch pour les parcelles (API définit const API = 'http://localhost:5000/api';)
    const geojson = await resp.json(); // pour transformer en geojson
    const features = new GeoJSON().readFeatures(geojson, { // on va lire les éléments contenu dans le geojson et le déclarer en variable features
      dataProjection:    'EPSG:2056',
      featureProjection: 'EPSG:2056'
});
vectorSource_parcelle.addFeatures(features);

    // Bâtiments dessinés -------------------------------------------------------------------------------------------------
    // Ici, on créer la source qui est vide actuellement pour les building qu'on va dessiner ainsi que son layer avec le style qu'on veut appliquer.
    // La source sera remplie à la suite du code en fonction de ce que dessine l'utilisateur.

    const buildingSource = new VectorSource();
    const buildingLayer  = new VectorLayer({
      source: buildingSource,
      style: new Style({
        stroke: new Stroke({ color: 'rgba(255,100,0,1)', width: 2 }),
        fill:   new Fill({   color: 'rgba(255,100,0,0.15)' }),
      }),
    });

    // on appel ici la fonction qui créer automatiquement le sidebar pour chaque layer

    addLayerControl(ortho,                "Orthophoto");
    addLayerControl(vectorLayer_limite,   "Limite communale");
    addLayerControl(vectorLayer_parcelle, "Parcelles");
    addLayerControl(buildingLayer,        "Bâtiments dessinés");

    // carte -------------------------------------------------------------------------------------------------
    const map = new Map({
      target: 'map',
      layers: [ortho, vectorLayer_limite, vectorLayer_parcelle, buildingLayer], // les couches à afficher
      view: new View({
        projection,
        center:  [2539522.36, 1181061.32], // coordonnée pour cibler yverdon
        zoom:    2,
        minZoom: 1,
        extent, // extent permet donc de limiter endroits où peut se déplacer l'utilisateur sur la carte (définit au début du code)
      }),
      controls:     defaultControls(),
      interactions: defaultInteractions()
    });

    // Popup -------------------------------------------------------------------------------------------------
    
    const container = document.getElementById('popup'); // le container c'est la boite du pop up entière
    const content   = document.getElementById('popup-content'); // le content c'est le texte à l'intérieur de la pop up
    const closer    = document.getElementById('popup-closer'); // Correspond à la croix qui permet de fermer le popup

    const overlay = new Overlay({ // l'overlay permet de coller un élément HTML à une position géographique
    // sur la carte (ici c'est le container donc la popup qui est affecté)
      element:          container,
      autoPan:          true, // la popup reste visible
      autoPanAnimation: { duration: 250 }, // durée de l'animation (en ms)
    });
    map.addOverlay(overlay); 

    // ce code permet de fermer la popup lorsque je clique sur la croix (définit par la variable closer)
    closer.onclick = function () {
      overlay.setPosition(undefined); // supprime la position du popup --> le fait disparaitre
      return false;
    };

    // outil de dessin -------------------------------------------------------------------------------------------------

    const typeSelect = document.getElementById('type');
    let isDrawing = false; // cette variable va permettre plus tard dans le code d'empêcher d'afficher la popup lorsque je suis en dessin
    let draw;
function addInteraction() {
  const value = typeSelect.value;
  if (value !== 'None') { // donc si on est sur "polygon"
    draw = new Draw({ source: buildingSource, type: value });
    map.addInteraction(draw); // on ajoute à la map l'interaction "draw"

    document.getElementById('undo').onclick = () => draw.removeLastPoint(); // permet via le bouton "annuler le dernier point" de supprimer le dernier point dessiné

    // Début du dessin
    draw.on('drawstart', function () {
      isDrawing = true; // le dessin est donc en cours
      buildingSource.clear(); // on supprime les anciens bâtiments dessinés
      overlay.setPosition(undefined); // on supprime la popup
    });

    // Fin du dessin 
    draw.on('drawend', async function (dessin) {
      isDrawing = false; // le dessin se termine, les popup peuvent donc s'afficher

      const geom = dessin.feature.getGeometry(); // on va chercher la géometrie de l'élement dessiné
      const area = getArea(geom); // à partir de cette géometrie, on calcul la surface 

      // Le nombre d'étage est demandé via un popup du site
      const etages = parseInt(prompt("Nombre d'étages du bâtiment :"));

      // Ici on va déclarer une nouvelle variable qui est un geojson vide
      // On va ensuite déclarer la variable buildingeojson qui correspond au geojson_empty avec les "feature" du dessin
      // l'objectif final est d'avoir le batiment dessiné en geojson
      const geoJSON_empty = new GeoJSON();
      const buildingGeoJSON = geoJSON_empty.writeFeatureObject(dessin.feature, {
        dataProjection:    'EPSG:2056',
        featureProjection: 'EPSG:2056'
      });

      // Envoi au backend Flask
      const resp = await fetch(`${API}/verifier`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: buildingGeoJSON.geometry,
          etages:   etages,
          area:     area
        })
      });

      const result = await resp.json();

      // Cette vérification permet d'assurer que le bâtiment dessiné ne chevauche pas plusieurs parcelles
      // Si il rentre dans le if, on affiche le message d'erreur et on return rien.

      if (!result.valide) {
        alert(result.erreur);
        buildingSource.clear();
        return;
      }
      // si le résultat est donc constructible --> respect des IOS, IUS 
      // alors la popup décrit après le "alerte" sera affiché à l'écran.
      if (result.constructible) {
        alert(
          `Construction autorisée\n\n` +
          `Parcelle : ${result.numero}\n` +
          `Surface bâtiment dessiné : ${area.toFixed(1)} m²\n` +
          `Étages : ${etages}\n` +
          `Hauteur estimée : ${result.hauteur} m\n\n` +
          `IOS : ${result.ios} / ${result.ios_max}\n` +
          `IUS : ${result.ius} / ${result.ius_max}`
        );
      // sinon, donc le bâtiment ne respecte pas 1 condition, on affiche que la construction est impossible
      // via une popup
      } else {
        alert(
          `Construction impossible\n\n` +
          `Parcelle : ${result.numero}\n` +
          `Surface bâtiment dessiné : ${area.toFixed(1)} m²\n` +
          `Étages : ${etages}\n\n` +
          `IOS : ${result.ios} / ${result.ios_max}\n` +
          `IUS : ${result.ius} / ${result.ius_max}`
        );
        buildingSource.clear();
      }
    });
  }
}

// Ce code permet simplement d'annuler un dessin si on passe de bâtiment (polygone) à aucun dans la fenêtre de selection
    typeSelect.onchange = function () {
      if (draw) map.removeInteraction(draw);
      addInteraction();
    };
    addInteraction();

   // clique sur parcelle

let selectedFeature = null; // de base on a rien sélectionné

map.on("singleclick", async function (dessin) {
  if (isDrawing) return; // si on est en train de dessiner --> isDrawing = True, on n'affiche rien
  // ici le code permet avec le foreachfeature... de récupérer les éléments dans l'endroit où l'on clique.
  // pour éviter de sélectionner autre chose que les parcelles, on ajoute un layerfilter pour uniquement selectionner 1 seule parcelle provenant de vectorlayer_parcelle
  const feature = map.forEachFeatureAtPixel( // on cherche dans le tableau features
    dessin.pixel, f => f,
    { layerFilter: l => l === vectorLayer_parcelle }
  );
  // ce code permet de lorsqu'on clique dans un endroit où il n'y a pas de parcelle, on en enlève la selection précédente et on enlève l'overlay (popup)
  if (!feature) {
    if (selectedFeature) { selectedFeature.setStyle(null); selectedFeature = null; }
    overlay.setPosition(undefined);
    return;
  }
// Si on avait sélectionné une géometrie et qu'on clique sur une nouvelle, on enlève la surbrillance de l'ancienne et on l'applique à la nouvelle
  if (selectedFeature && selectedFeature !== feature) selectedFeature.setStyle(null);
  feature.setStyle(selected);
  selectedFeature = feature;

  const numero = feature.get('NUMERO'); // on va chercher le numero de parcelle 
  content.innerHTML = `<p>Chargement...</p>`; // affiche chargement dans la popup le temps que l'opération est en cours
  overlay.setPosition(dessin.coordinate); // pour positionner la popup à l'endroit où on clique

  const resp = await fetch(`${API}/parcelles/${numero}`); // on envoie une requête au backend pour récupérer les infos de la parcelle avec le numéro qu'on a (réponse http brut)
  const data = await resp.json(); // renvoie la réponse et transformation en json pour qu'il soit lisible par javascript

  // c'est ce que contient le popup --> le style de la popup a été repris d'un exemple openlayer
  content.innerHTML = `
    <b>Parcelle ${data.NUMERO}</b>
    <table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-top:6px"> 
      <tr><td style="padding:2px 6px">Identifiant</td>      <td><b>${data.IDENTDN ?? '—'}</b></td></tr>
      <tr><td style="padding:2px 6px">Genre</td>            <td><b>${data.GENRE_TXT ?? '—'}</b></td></tr>
      <tr><td style="padding:2px 6px">Surface</td>          <td><b>${Number(data.SUPERFICIE).toFixed(1)} m²</b></td></tr>
      <tr><td colspan="2"><hr style="margin:4px 0"></td></tr>
      <tr><td style="padding:2px 6px">Bâtiments</td>        <td><b>${data.nb_batiments}</b></td></tr>
      <tr><td style="padding:2px 6px">Surface au sol</td>   <td><b>${Number(data.surface_au_sol).toFixed(1)} m²</b></td></tr>
      <tr><td style="padding:2px 6px">Surface plancher</td> <td><b>${Number(data.surface_plancher).toFixed(1)} m²</b></td></tr>
      <tr><td colspan="2"><hr style="margin:4px 0"></td></tr>
      <tr style="background:#eef"><td style="padding:2px 6px"><b>IOS</b></td><td><b>${data.ios}</b></td></tr>
      <tr style="background:#eef"><td style="padding:2px 6px"><b>IUS</b></td><td><b>${data.ius}</b></td></tr>
    </table>
  `;
});
})