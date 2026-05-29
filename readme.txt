

ÉTAPE 1 — Restaurer la base de données PostgreSQL
--------------------------------------------------------------------------------------

1. Ouvrir pgAdmin
2. Créer une nouvelle base de données nommée : yverdon
3. Clic droit sur la base "yverdon" → Restore...
4. Vérifier que l'extension PostGIS est activée sur la base :
   Dans pgAdmin → Query Tool sur la base yverdon, exécuter :

      CREATE EXTENSION IF NOT EXISTS postgis;

ÉTAPE 2 — Lancer le backend Flask
--------------------------------------------------------------------------------------

1. Ouvrir un terminal (UV) et se placer dans le dossier backend du projet :

      cd chemin.../Projet géoinformatique/projet

2. Installer les dépendances Python :

      déjà présente sur UV

3. Lancer le serveur Flask :

      python flask_backend.py

4. Le backend est accessible sur : http://localhost:5000
   Laisser ce terminal ouvert.



ÉTAPE 3 — Lancer le frontend
--------------------------------------------------------------------------------------

1. Ouvrir un NOUVEAU terminal (pas besoin de UV) et se placer dans le dossier frontend du projet :

     cd chemin.../Projet géoinformatique/projet

2. Installer les dépendances Node.js :

      npm install

3. Lancer le frontend :

      npm start

4. Ouverture du site via :
	http://localhost:5173/ (c'est l'adresse de base du bundler Vite)

INFORMATIONS BASE DE DONNÉES
--------------------------------------------------------------------------------------

  Hôte     : localhost
  Port     : 5432
  Nom      : yverdon
  User     : postgres
  Password : postgres

