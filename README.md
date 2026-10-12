<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HEF Creative - Studio</title>
    <style>
        :root {
            --bg-color: #121212;
            --card-bg: #1e1e1e;
            --text-main: #ffffff;
            --text-muted: #a0a0a0;
            --accent: #bb86fc;
            --accent-hover: #9965f4;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            line-height: 1.6;
            padding: 20px;
        }

        header {
            text-align: center;
            padding: 40px 20px;
            background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
            border-radius: 16px;
            margin-bottom: 30px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }

        h1 {
            font-size: 2.5rem;
            background: linear-gradient(90deg, var(--accent), #03dac6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }

        p.subtitle {
            color: var(--text-muted);
            font-size: 1.1rem;
        }

        .controls {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin-bottom: 30px;
        }

        button {
            background-color: var(--accent);
            color: #000;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 1rem;
        }

        button:hover {
            background-color: var(--accent-hover);
            transform: translateY(-2px);
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .card {
            background-color: var(--card-bg);
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #333;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            position: relative;
        }

        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 25px rgba(187, 134, 252, 0.2);
            border-color: var(--accent);
        }

        .card h3 {
            color: var(--accent);
            margin-bottom: 10px;
        }

        .card p {
            color: var(--text-muted);
            font-size: 0.95rem;
        }

        .card .delete-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #ff4444;
            color: white;
            border: none;
            border-radius: 50%;
            width: 25px;
            height: 25px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .card:hover .delete-btn {
            opacity: 1;
        }

        footer {
            text-align: center;
            margin-top: 50px;
            color: var(--text-muted);
            font-size: 0.9rem;
        }
    </style>
</head>
<body>

    <header>
        <h1>HEF Creative</h1>
        <p class="subtitle">Mon espace de création en ligne</p>
    </header>

    <div class="controls">
        <button onclick="ajouterProjet()">+ Ajouter un projet</button>
    </div>

    <div class="grid" id="projets-grid">
        <!-- Les projets s'afficheront ici -->
    </div>

    <footer>
        <p>&copy; 2026 HEF Creative. Hébergé sur GitHub Pages.</p>
    </footer>

    <script>
        // Initialisation des projets par défaut si le stockage est vide
        let projets = JSON.parse(localStorage.getItem('hefProjets')) || [
            { id: 1, titre: "Mon Premier Projet", description: "Une belle application web créée avec passion." },
            { id: 2, titre: "Design Graphique", description: "Exploration de nouvelles tendances visuelles." }
        ];

        const grid = document.getElementById('projets-grid');

        // Fonction pour afficher les projets
        function afficherProjets() {
            grid.innerHTML = '';
            projets.forEach(projet => {
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <button class="delete-btn" onclick="supprimerProjet(${projet.id})">X</button>
                    <h3>${projet.titre}</h3>
                    <p>${projet.description}</p>
                `;
                grid.appendChild(card);
            });
            // Sauvegarder dans le navigateur
            localStorage.setItem('hefProjets', JSON.stringify(projets));
        }

        // Fonction pour ajouter un projet
        function ajouterProjet() {
            const titre = prompt("Nom du projet :");
            if (!titre) return;
            const description = prompt("Description du projet :") || "Aucune description.";
            
            const nouveauProjet = {
                id: Date.now(), // ID unique basé sur le temps
                titre: titre,
                description: description
            };

            projets.push(nouveauProjet);
            afficherProjets();
        }

        // Fonction pour supprimer un projet
        function supprimerProjet(id) {
            projets = projets.filter(p => p.id !== id);
            afficherProjets();
        }

        // Afficher les projets au chargement de la page
        afficherProjets();
    </script>

</body>
</html>
