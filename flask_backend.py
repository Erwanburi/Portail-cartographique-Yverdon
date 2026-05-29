from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
import psycopg2.extras
import json

app = Flask(__name__)
CORS(app)  # Autorise les requêtes cross-origin depuis le frontend (Vite)

# Définit les paramètres de la base de données PostgreSQL --> pour pouvoir se connecter
DB = {
    "host":     "localhost",
    "port":     5432,
    "dbname":   "yverdon",
    "user":     "postgres",
    "password": "postgres"
}

def get_conn():
    """
    La fonction permet d'ouvrir la base de donnée (avec les paramètres définis précédemment) puis de la retourner
    """
    return psycopg2.connect(**DB)


# Route 1, chargement de toutes les parcelles 

@app.route('/api/parcelles')
def get_parcelles():
    """
    Retourne toutes les parcelles de la base de données sous forme de GeoJSON.
    Utilisée au chargement de la carte pour afficher tous les polygones.
    ST_AsGeoJSON (fonction PostGIS) convertit la géométrie PostgreSQL en GeoJSON
    qui permet à openlayer de les lires. 
    """
    conn = get_conn()
    # RealDictcursor permet d'accéder aux colonnes par leur nom (ex: row["NUMERO"])
    # plutôt que par index (ex: row[0])
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # On récupère les informations de base de chaque parcelle 
    # le geom IS NOT NULL permet d'éviter les géometries avec des valeurs non exploitables
    cur.execute("""
        SELECT
            "NUMERO",
            "SUPERFICIE",
            "GENRE_TXT",
            "IDENTDN",
            ST_AsGeoJSON(geom)::json AS geometry
        FROM parcelles
        WHERE geom IS NOT NULL
    """)

    rows = cur.fetchall() # permet de retourner sous forme de liste toutes les lignes prises pas le cur.exectute
    cur.close()
    conn.close()

    # Ici on va construire le geojson pour que openlayer puisse le lire et afficher des polygones sur carte
    features = []
    for row in rows:
        features.append({
            "type": "Feature",
            "geometry": row["geometry"],       # polygone de la parcelle
            "properties": {                    # données affichées dans le popup
                "NUMERO":     row["NUMERO"],
                "SUPERFICIE": row["SUPERFICIE"],
                "GENRE_TXT":  row["GENRE_TXT"],
                "IDENTDN":    row["IDENTDN"],
            }
        })
    # on retourne donc le fichier geojson qui contient les données
    return jsonify({
        "type": "FeatureCollection",
        "features": features
    })


# La route 2 permet de retourner les information de la parcelle sélectionnée à l'aide de son numéro d'identification
@app.route('/api/parcelles/<numero>')
def get_parcelle(numero):
    """
    La requête SQL ci dessous réalise divers calcul à l'aide d'une jointure spatiale avec la
    table regbl
    Elle retourne :
    - le nbr de bâtiment présent sur la parcelle
    - La surface au sol totale des bâtiments (addition)
    - La surface de plancher totale (donc surface x le nombre d'étage par bâtiment puis on les additionnes)
    - L'IOS qui correspond à l'indice d'occupation du sol (surface au sol / surface parcelle)
    - L'IUS qui corresond à l'indice d'utilisation du sol (surface plancher / surface parcelle)

    ST_Contains (fonction PostgreSQL) vérifie si le bâtiment se situe dans la parcelle
    COALESCE remplace NULL par 0 si aucun bâtiment dans parcelle
    LEFT JOIN est utilisé ici pour pouvoir garder la parcelle même si il n'y a aucun bâtiment regbl
    """
    conn = get_conn()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT
            p."NUMERO",
            p."SUPERFICIE",
            p."GENRE_TXT",
            p."IDENTDN",

            COALESCE(SUM(r."GAREA"), 0) AS surface_au_sol,

            COALESCE(SUM(r."GAREA" * r."GASTW"), 0) AS surface_plancher,

            CASE WHEN p."SUPERFICIE" > 0
            THEN ROUND((SUM(COALESCE(r."GAREA", 0)) / p."SUPERFICIE")::numeric, 3)
            ELSE 0
            END AS ios,

            CASE WHEN p."SUPERFICIE" > 0
            THEN ROUND((SUM(COALESCE(r."GAREA" * r."GASTW", 0)) / p."SUPERFICIE")::numeric, 3)
            ELSE 0
            END AS ius,
            COUNT(r.*) AS nb_batiments
            FROM parcelles p
            LEFT JOIN regbl r
            ON ST_Contains(p.geom, r.geom)
            WHERE p."NUMERO" = %s
            GROUP BY p."NUMERO", p."SUPERFICIE", p."GENRE_TXT", p."IDENTDN"
    """, (numero,)) # le "numero" s'affiche sur le %

    row = cur.fetchone() # Retourne uniquement la 1ère ligne
    cur.close()
    conn.close()

    return jsonify(dict(row))


# La route 3 permet la vérification des droits à bâtir lors du dessin d'un nouveau bâtiment --> est-ce qu'on peut construire ou pas
@app.route('/api/verifier', methods=['POST'])
def verifier_construction():
    """
    Il va récupérer depuis le frontend :
      - geometry : le polygone du bâtiment dessiné par l'utilisateur en GeoJSON
      - etages   : le nombre d'étages que l'utilisateur a écrit dans le prompt
      - area     : la surface du bâtiment calculée côté frontend en m2

    Vérifie via PostGIS que le bâtiment est entièrement contenu dans une seule parcelle,
    puis recalcule l'IOS et l'IUS en tenant compte du nouveau bâtiment.
    Retourne si la construction est autorisée ou non selon le règlement pour l'IOS et IUS décrit ci-dessous.
    """
    data             = request.get_json()
    geojson_batiment = data.get('geometry')   # polygone GeoJSON du bâtiment dessiné
    geojson_batiment_chaintext = (json.dumps(geojson_batiment),)
    etages           = data.get('etages', 1)  # nb d'étages saisi par l'utilisateur
    area             = data.get('area', 0)    # surface calculée par OpenLayers dans le frontend

    conn = get_conn()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Recherche la parcelle qui contient entièrement le bâtiment dessiné --> pour éviter qu'il soit sur 2 parcelles
    # + calculer état actuel des bâtiments existants
    # ST_GeomFromGeoJSON --> convertit le GeoJSON en géométrie PostGIS
    # ST_SetSRID(..., 2056) --> définit le système de coordonnées suisse (MN95) 
    # ST_Contains : retourne une ligne uniquement si le bâtiment est dans la parcelle
    # → si le bâtiment chevauche 2 parcelles ou est hors parcelle : aucune ligne retournée
    # COALESCE remplace NULL par 0 --> si la parcelle à aucun bâtiment
    # LEFT JOIN est utilisé ici pour pouvoir garder la parcelle même si il n'y a aucun bâtiment regbl
    cur.execute("""
        SELECT
            parcelles."NUMERO",
            parcelles."SUPERFICIE",
            COALESCE(SUM(regbl."GAREA"), 0) AS surface_sol_existante,
            COALESCE(SUM(regbl."GAREA" * regbl."GASTW"), 0) AS surface_plancher_existante
            FROM parcelles
            LEFT JOIN regbl ON ST_Contains(parcelles.geom, regbl.geom)
            WHERE ST_Contains(
            parcelles.geom,
            ST_SetSRID(ST_GeomFromGeoJSON(%s), 2056))
            GROUP BY parcelles."NUMERO", parcelles."SUPERFICIE"
    """, geojson_batiment_chaintext)

    row = cur.fetchone() # récupérer une unique ligne car on attend une seule parcelle --> pas besoin de list avec fetchall()
    cur.close()
    conn.close()

    # Si aucune parcelle ne contient le bâtiment--> il est hors parcelle ou à cheval sur plusieurs.
    # On retourne valide=False avec un message d'erreur affiché dans le frontend (result.erreur)
    if not row:
        return jsonify({
            "valide": False,
            "erreur": "Le bâtiment doit se situer dans une seule parcelle"
        })

    # Calcul de l'IOS et IUS avec le nouveau bâtiment 
    surf_parcelle = float(row["SUPERFICIE"])
    # On additionne la surface existante + le nouveau bâtiment
    surf_sol      = float(row["surface_sol_existante"]) + area
    surf_plancher = float(row["surface_plancher_existante"]) + (area * etages)

    if surf_parcelle > 0:
        ios = round(surf_sol / surf_parcelle, 3)       # arrondie à 3 chiffres
        ius = round(surf_plancher / surf_parcelle, 3)  # arrondie à 3 chiffres
    else:
        ios = 0
        ius = 0

    # Valeurs maximales selon le règlement de construction (fictif)
    IOS_MAX = 0.30  # max 30% de la parcelle peut être couverte
    IUS_MAX = 0.80  # max 80% de la parcelle en surface de plancher

    # Réponse envoyée au frontend
    return jsonify({
        "valide":        True,
        "numero":        row["NUMERO"],
        "superficie":    surf_parcelle,
        "ios":           ios,
        "ios_max":       IOS_MAX,
        "ius":           ius,
        "ius_max":       IUS_MAX,
        # True si les deux indices respectent le règlement
        "constructible": ios <= IOS_MAX and ius <= IUS_MAX,
        # Hauteur estimée : 2.7m par étage + 3m (toiture/fondations)
        "hauteur":       round(etages * 2.7 + 3, 1)
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)