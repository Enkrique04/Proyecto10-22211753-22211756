const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const mysql = require('mysql2');
const xlsx = require('xlsx');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config(); // Cargar las variables de entorno

const fs = require('fs');
const PDFDocument = require('pdfkit');

timezone: 'America/Tijuana'

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
      if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
          next();
      } else {
          res.status(403).send('Acceso denegado');
      }
  };
}

app.use(session({
  secret: 'secretKey',
  resave: false,
  saveUninitialized: false,
}));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la página principal
app.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir archivos estáticos (HTML)
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.urlencoded({ extended: true }));


// Conexión a MySQL
const connection = mysql.createConnection({ 
  host: process.env.DB_HOST,       //Host desde .env
  user: process.env.DB_USER,       // Usuario desde .env
  password: process.env.DB_PASSWORD,   // Contraseña desde .env
  database: process.env.DB_NAME,    // Nombre de la base de datos desde .env
});

connection.connect();

// Ruta para obtener el tipo de usuario actual
app.get('/tipo-usuario', requireLogin, (req, res) => {
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});

// Registro de usuario
app.post('/registro', (req, res) => {
  const { username, password, codigo_acceso } = req.body;

  const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
  connection.query(query, [codigo_acceso], (err, results) => {
      if (err || results.length === 0) {
          return res.send('Código de acceso inválido');
      }

      const tipo_usuario = results[0].tipo_usuario;
      const hashedPassword = bcrypt.hashSync(password, 10);

      const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)';
      connection.query(insertUser, [username, hashedPassword, tipo_usuario], (err) => {
          if (err) return res.send('Error al registrar usuario');
          res.redirect('/login.html');
      });
  });
});

app.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body;

  const query = 'SELECT * FROM usuarios WHERE nombre_usuario = ?';
  connection.query(query, [nombre_usuario], (err, results) => {
      if (err) {
          return res.send('Error al obtener el usuario');
      }

      if (results.length === 0) {
          return res.send('Usuario no encontrado');
      }

      const user = results[0];

      const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
      if (!isPasswordValid) {
          return res.send('Contraseña incorrecta');
      }
      req.session.user = {
          id: user.id,
          nombre_usuario: user.nombre_usuario,
          tipo_usuario: user.tipo_usuario // Aquí se establece el tipo de usuario en la sesión
      };  
      res.redirect('/');
  });
});

// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

connection.connect(err => {
  if (err) {
    console.error('Error conectando a MySQL:', err);
    return;
  }
  console.log('Conexión exitosa a MySQL');
});

app.post('/submit-data', requireLogin, requireRole('admin','medico'),(req, res) => {
  const { name, age, heart_rate, height, medico_id } = req.body;

  const query = 'INSERT INTO pacientes (nombre, edad, frecuencia_cardiaca, altura, medico_id) VALUES (?, ?, ?, ?, ?)';
  connection.query(query, [name, age, heart_rate, height, medico_id], (err, result) => {
    if (err) {
      return res.send('Error al guardar los datos en la base de datos.');
    }
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Paciente ${name} guardado en la base de datos.</h1>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});

app.get('/ver-usuarios', requireLogin, requireRole('admin'), (req, res) => {
  const query = 'SELECT * FROM usuarios';
  connection.query(query, (err, results) => {
      if (err){ return res.send('Error al obtener usuarios');
      res.send(results);
      }
      let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Usuarios</title>
      </head>
      <body>
        <h1>Usuarios Registrados</h1>
        <table>
          <thead>
            <tr>
            <th>ID</th>
              <th>Nombre</th>
              <th>Tipo de usuario</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    results.forEach(usuarios => {
      html += `
        <tr>
          <td>${usuarios.id}</td>
          <td>${usuarios.nombre_usuario}</td>
          <td>${usuarios.tipo_usuario}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
      res.send(html);
    });
});
  
app.get('/ver-mis-datos', (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Usuario no autenticado');
    }

    const { nombre_usuario, tipo_usuario } = req.session.user;

    let html = `
    <html>
    <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Mis Datos</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f0f2f5;
                color: #333;
                display: flex;
                flex-direction: column;
                align-items: center;
                margin: 0;
                padding: 20px;
            }
            h1 {
                color: #4CAF50;
                text-align: center;
            }
            table {
                width: 50%;
                border-collapse: collapse;
                margin-top: 20px;
            }
            th, td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #ddd;
            }
            th {
                background-color: #4CAF50;
                color: white;
            }
            tr:hover {
                background-color: #f5f5f5;
            }
            button {
                margin-top: 20px;
                padding: 10px 20px;
                font-size: 16px;
                background-color: #4CAF50;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                transition: background-color 0.3s ease;
            }
            button:hover {
                background-color: #45a049;
            }
        </style>
    </head>
    <body>
        <h1>Mis Datos</h1>
        <table>
            <tr>
                <th>Campo</th>
                <th>Valor</th>
            </tr>
            <tr>
                <td>Nombre de Usuario</td>
                <td>${nombre_usuario}</td>
            </tr>
            <tr>
                <td>Tipo de Usuario</td>
                <td>${tipo_usuario}</td>
            </tr>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
    `;

    res.send(html);
});
  
app.get('/editar-pacientes', requireLogin, requireRole('medico', 'admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editar-pacientes.html'));
});

app.get('/obtener-paciente/:id', requireLogin, requireRole('medico', 'admin'), (req, res) => {
  const { id } = req.params;
  const query = 'SELECT * FROM pacientes WHERE id = ?';
  connection.query(query, [id], (err, results) => {
    if (err) return res.status(500).send('Error al obtener el paciente');
    if (results.length === 0) return res.status(404).send('Paciente no encontrado');
    res.json(results[0]);
  });
});

app.post('/editar-pacientes', requireLogin, requireRole('medico', 'admin'), (req, res) => {
  const { id, nombre, edad, frecuencia_cardiaca, altura, medico_id} = req.body;
  const query = 'UPDATE pacientes SET nombre = ?, edad = ?, frecuencia_cardiaca = ?, altura = ?, medico_id = ? WHERE id = ?';
  connection.query(query, [nombre, edad, frecuencia_cardiaca, altura, medico_id, id], (err, result) => {
    if (err) return res.send('Error al actualizar los datos del paciente.');
    const html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Paciente ${nombre} actualizado correctamente.</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);

  });
});

app.delete('/eliminar-paciente/:id', requireLogin, requireRole('medico', 'admin'), (req, res) => {
  const { id } = req.params; 
  const query = 'DELETE FROM pacientes WHERE id = ?';
  connection.query(query, [id], (err, result) => {
    if (err) return res.status(500).send('Error al eliminar el paciente');
    if (result.affectedRows === 0) return res.status(404).send('Paciente no encontrado');
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Paciente con ID ${id} eliminado exitosamente.</h1>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});

app.get('/editar-medico', requireLogin, requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editar-medico.html'));
});

app.get('/obtener-medico/:id', requireLogin, requireRole('medico', 'admin'), (req, res) => {
  const { id } = req.params;
  const query = 'SELECT * FROM medicos WHERE id = ?';
  connection.query(query, [id], (err, results) => {
    if (err) return res.status(500).send('Error al obtener el medicos');
    if (results.length === 0) return res.status(404).send('Medico no encontrado');
    res.json(results[0]);
  });
});

app.post('/editar-medico', requireLogin, requireRole('medico', 'admin'), (req, res) => {
  const { id, nombre, especialidad, salario} = req.body;
  const query = 'UPDATE medicos SET nombre = ?, especialidad = ?, salario = ? WHERE id = ?';
  connection.query(query, [nombre, especialidad, salario, id], (err, result) => {
    if (err) return res.send('Error al actualizar los datos del medicos.');
    const html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Medico ${nombre} actualizado correctamente.</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);

  });
});

app.delete('/eliminar-medico/:id', requireLogin, requireRole('admin'), (req, res) => {
  const { id } = req.params; 
  const query = 'DELETE FROM medicos WHERE id = ?';
  connection.query(query, [id], (err, result) => {
    if (err) return res.status(500).send('Error al eliminar el medico');
    if (result.affectedRows === 0) return res.status(404).send('Medico no encontrado');
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Medico con ID ${id} eliminado exitosamente.</h1>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});

app.get('/Ver-pacientes', requireLogin, requireRole('medico','admin'), (req, res) => {
    connection.query('SELECT * FROM pacientes', (err, results) => {
      if (err) {
        return res.send('Error al obtener los datos.');
      }
      let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes</title>
      </head>
      <body>
        <h1>Pacientes Registrados</h1>
        <table>
          <thead>
            <tr>
            <th>ID</th>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Frecuencia Cardiaca (bpm)</th>
              <th>Altura(cm)</th>
              <th>Id del medico<th/>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.id}</td>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.frecuencia_cardiaca}</td>
          <td>${paciente.altura}</td>
          <td>${paciente.medico_id}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

      res.send(html);
    });
});

app.get('/buscar-pacientes', requireLogin, requireRole('medico','admin'), (req, res) => {
  const { name_search, age_search } = req.query;
  let query = 'SELECT * FROM pacientes WHERE 1=1';
  query += ` AND nombre LIKE '%${name_search}%'`;
  
  if (age_search) {
    query += ` AND edad = ${age_search}`;
  }

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Resultados de Búsqueda</title>
      </head>
      <body>
        <h1>Resultados de Búsqueda</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Frecuencia Cardiaca (bpm)</th>
              <th>Altura</th>
              <th>ID del medico</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.frecuencia_cardiaca}</td>
          <td>${paciente.altura}</td>
          <td>${paciente.medico_id}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});+

app.post('/iniciar', requireLogin, requireRole('admin'), (req, res) => {
  const query = 'START TRANSACTION;';
  connection.query(query, (err, result) => {
    if (err) {
      return res.send('Error al insertar el médico.');
    }
    res.redirect('/varios_medicos.html');
  });
});

app.post('/insertar-medico', requireLogin, requireRole('admin'), (req, res) => {
  const { medico_name, especialidad, salario } = req.body;
  const query = `INSERT INTO medicos (nombre, especialidad, salario) VALUES (?, ?, ?);`;

  connection.query(query,[medico_name, especialidad, salario], (err, result) => {
    if (err) {
      return res.send('Error al insertar el médico.');
    }
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Médico ${medico_name} guardado exitosamente.</h1>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});

app.post('/insertar-medicos', requireLogin, requireRole('admin'), (req, res) => {
  const { medico_name, especialidad, salario } = req.body;
  const query = `INSERT INTO medicos (nombre, especialidad, salario) VALUES (?, ?, ?);`;

  connection.query(query,[medico_name, especialidad, salario], (err, result) => {
    if (err) {
      return res.send('Error al insertar el médico.');
    }
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Médico ${medico_name} guardado exitosamente.</h1>
      <button onclick="window.location.href='/varios_medicos.html'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});


app.get('/aceptar', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('COMMIT;') 
  connection.query('SELECT * FROM medicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Medicos</title>
    </head>
    <body>
      <h1>Tabla Actualizada de Medicos Registrados</h1>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Especialidad</th>
            <th>Salario</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(medico => {
    html += `
      <tr>
        <td>${medico.nombre}</td>
        <td>${medico.especialidad}</td>
        <td>${medico.salario}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/cancelar', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('ROLLBACK;', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Transaccion cancelada</h1>
        <tbody>
  `;

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/medicos', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('SELECT * FROM medicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Medicos</title>
    </head>
    <body>
      <h1>Medicos Registrados</h1>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Especialidad</th>
            <th>Salario</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(medico => {
    html += `
      <tr>
        <td>${medico.nombre}</td>
        <td>${medico.especialidad}</td>
        <td>${medico.salario}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
      <button onclick="window.location.href='/sal_med'">Slarios ordenados</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/sugerencias', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('SELECT * FROM suggestion', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Medicos</title>
    </head>
    <body>
      <h1>Reseñas de doctores</h1>
      <table>
        <thead>
          <tr>
            <th>Nombre del Paciente</th>
            <th>Nombre del Medico</th>
            <th>Sugerencia</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(suggestion => {
    html += `
      <tr>
        <td>${suggestion.nombre_pac}</td>
        <td>${suggestion.nombre_med}</td>
        <td>${suggestion.suggestion}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/sal_med', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('SELECT id, nombre, especialidad, salario FROM medicos ORDER BY salario DESC', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Medicos</title>
    </head>
    <body>
      <h1>Medicos Registrados</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Especialidad</th>
            <th>Salario</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(medico => {
    html += `
      <tr>
        <td>${medico.id}</td>
        <td>${medico.nombre}</td>
        <td>${medico.especialidad}</td>
        <td>${medico.salario}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/medico_paciente', requireLogin,requireRole('admin','medico'), (req, res) => {
  connection.query('SELECT * FROM medico_paciente', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Medicos</title>
    </head>
    <body>
      <h1>Medicos Registrados</h1>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Edad</th>
            <th>Medico</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(medico_paciente => {
    html += `
      <tr>
        <td>${medico_paciente.nombre}</td>
        <td>${medico_paciente.edad}</td>
        <td>${medico_paciente.medico}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.post('/tecnico', requireLogin, requireRole('admin', 'tecnico'), (req, res) => {
  const { nombre, salario } = req.body;
  const query = 'INSERT INTO tecnicos (nombre, salario) VALUES (?, ?)';

  connection.query(query,[nombre, salario], (err, result) => {
    if (err) {
      return res.send('Error al añadir al tecnico.');
    }
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>El tecnico ${nombre} acaba de ser contratado</h1>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});

app.get('/tecnicos', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('SELECT * FROM tecnicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Aparatos</title>
    </head>
    <body>
      <h1>Aparatos que se les realizo un servicio</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Tecnico</th>
            <th>Salario</th> 
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(tecnico => {
    html += `
      <tr>
        <td>${tecnico.id}</td>
        <td>${tecnico.nombre}</td>
        <td>${tecnico.salario}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
      <button onclick="window.location.href='/sal_tec'">Tecnicos con sueldo mayor al promedio</button>
    </body>
    </html>
  `;
    res.send(html);
  });
});

app.get('/sal_tec', requireLogin,requireRole('admin'), (req, res) => {
  connection.query('SELECT id, nombre, salario FROM tecnicos WHERE salario > (SELECT AVG(salario) FROM tecnicos); ', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Aparatos</title>
    </head>
    <body>
      <h1>Aparatos que se les realizo un servicio</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Tecnico</th>
            <th>Salario</th> 
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(tecnico => {
    html += `
      <tr>
        <td>${tecnico.id}</td>
        <td>${tecnico.nombre}</td>
        <td>${tecnico.salario}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
    res.send(html);
  });
});

app.post('/ultimo_uso', requireLogin, requireRole('admin', 'tecnico'), (req, res) => {
  const { nombre, tecnico } = req.body;
  const query = 'INSERT INTO equipos (nombre, tecnico_id) VALUES (?, ?)';

  connection.query(query,[nombre, tecnico], (err, result) => {
    if (err) {
      return res.send('Error al añadir aparato medico.');
    }
    const html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>El aparato ${nombre} acaba de recibir un servicio</h1>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;
  res.send(html);
  });
});

app.get('/revision', requireLogin,requireRole('admin','tecnico'), (req, res) => {
  connection.query('SELECT * FROM equipos_tec', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Aparatos</title>
    </head>
    <body>
      <h1>Aparatos que se les realizo un servicio</h1>
      <table>
        <thead>
          <tr>
            <th>Nombre del aparato</th>
            <th>Fecha en que se realizo servicio</th>
            <th>Tecnico que realizo servicio</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(equipos_tec => {
    html += `
      <tr>
        <td>${equipos_tec.nombre}</td>
        <td>${equipos_tec.fecha_revision}</td>
        <td>${equipos_tec.tecnico}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('excelFile'), (req, res) => {
  const filePath = req.file.path;
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

  data.forEach(row => {
    const { nombre, descripcion, fecha_revision } = row;
    const sql = `INSERT INTO aparatos_medicos (nombre, descripcion) VALUES (?, ?)`;
    connection.query(sql, [nombre, descripcion, fecha_revision], err => {
      if (err) throw err;
    });
  });
  const html = `
  <html>
  <head>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <h1>Archivo cargado y datos guardados</h1>
      <button onclick="window.location.href='/equipos.html'">Volver</button>
  </body>
  </html>
`;
res.send(html);
});

app.get('/download', (req, res) => {
  const sql = `SELECT * FROM aparatos_medicos`;
  connection.query(sql, (err, results) => {
    if (err) throw err;

    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Equipos');

    const filePath = path.join(__dirname, 'uploads', 'equipos.xlsx');
    xlsx.writeFile(workbook, filePath);
    res.download(filePath, 'equipos.xlsx');
  });
});

app.get('/downloadpdf', requireLogin, requireRole('admin'), (req, res) => {
  const sql = `SELECT * FROM aparatos_medicos`;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error("Error al consultar la base de datos:", err);
      return res.status(500).send('Error al obtener los datos.');
    }
    const doc = new PDFDocument({ autoFirstPage: false }); 
    const filePath = path.join(__dirname, 'uploads', 'aparatos_medicos.pdf');

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.addPage();

    doc.fontSize(16).text('Aparatos en el hospital', { align: 'center' }).moveDown();
    
    doc.fontSize(12).text('Aparatos y estado de estos', { align: 'center' }).moveDown(2);

    doc.fontSize(10).text('Estado de los aparatos', { align: 'left' }).moveDown();

    results.forEach((aparatos_medicos, index) => {
      doc.text(`ID: ${aparatos_medicos.id}     Nombre del dispositivo: ${aparatos_medicos.nombre}     Estado: ${aparatos_medicos.descripcion}`, { align: 'left' }).moveDown();
    });

    doc.end();

    stream.on('finish', () => {
      res.download(filePath, 'aparatos_medicos.pdf', (err) => {
        if (err) {
          console.error('Error al descargar el archivo:', err);
          res.status(500).send('Error al descargar el archivo.');
        } else {

          fs.unlinkSync(filePath);
        }
      });
    });
  });
});

app.post('/submit-suggestion', (req, res) => {
  const { nombre, nombre_med, suggestion } = req.body;

  const query = 'INSERT INTO suggestion (nombre_pac, nombre_med, suggestion) VALUES (?, ?, ?)';
  connection.query(query, [nombre, nombre_med, suggestion], (err, result) => {
    if (err) {
      return res.send('No se pudo enviar su sugerencia');
    }
    const html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Muchas gracias por sus comentarios!!</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});

app.post('/eliminar-columna', (req, res) => {
  const { columna } = req.body;

  if (!columna) {
    return res.status(400).send('Por favor proporciona un nombre de columna válido.');
  }

  const query = `ALTER TABLE aparatos_medicos DROP COLUMN ??`;

  connection.query(query, [columna], (err, result) => {
    if (err) {
      console.error('Error eliminando la columna:', err);
      return res.status(500).send('Hubo un error eliminando la columna.');
    }

    const html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>La columna "${columna}" ha sido eliminada con éxito.</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});

app.post('/agregar-columna', (req, res) => {
  const { columna, tipo } = req.body;

  if (!columna || !tipo) {
    return res.status(400).send('Proporcione un nombre y un tipo de dato válidos para la nueva columna.');
  }

  const query = `ALTER TABLE aparatos_medicos ADD COLUMN ?? ${tipo}`;
  connection.query(query, [columna], (err, result) => {
    if (err) {
      console.error('Error al agregar la columna:', err);
      return res.status(500).send('Hubo un error al agregar la columna.');
    }
    const html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>La columna "${columna}" ha sido agregada con éxito.</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});


app.post('/editar-columna', (req, res) => {
  const { columna_actual, nuevo_nombre, nuevo_tipo } = req.body;

  if (!columna_actual || !nuevo_nombre || !nuevo_tipo) {
    return res.status(400).send('Proporcione el nombre actual, el nuevo nombre y el nuevo tipo de dato.');
  }

  const query = `ALTER TABLE aparatos_medicos CHANGE COLUMN ?? ?? ${nuevo_tipo}`;
  connection.query(query, [columna_actual, nuevo_nombre], (err, result) => {
    if (err) {
      console.error('Error al editar la columna:', err);
      return res.status(500).send('Hubo un error al editar la columna.');
    }

    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Pacientes</title>
    </head>
    <body>
      <h1>La columna "${columna_actual}" ha sido renombrada a "${nuevo_nombre}" y su tipo ha sido actualizado.</h1>
    `;

    
    html += `
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
    `;
    
    res.send(html);
    });
    });

    app.get('/buscar', (req, res) => {
      const query = req.query.query;
      const sql = `SELECT nombre_usuario, tipo_usuario FROM usuarios WHERE nombre_usuario LIKE ?`;
      connection.query(sql, [`%${query}%`], (err, results) => {
        if (err) throw err;
        res.json(results);
      });
    });

    const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('Servidor corriendo en http://localhost:3000');
  });
