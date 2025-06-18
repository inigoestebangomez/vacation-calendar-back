import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================= SQLITE =========================
//conexión a la base de datos
const dbPromise = open({
    filename: "./employees.db",
    driver: sqlite3.Database
});

// acceder a la base de datos
async function getDb() {
    return await dbPromise;
}

// Activar WAL para mejorar concurrencia
(async () => {
  const db = await dbPromise;
  await db.exec('PRAGMA journal_mode = WAL;');
  console.log('SQLite WAL mode enabled');
})();

// ========================= AUTENTICACIÓN =========================
// obtener la configuración de autenticación
app.get("/api/config", (req, res) => {
  res.json({
    clientId: process.env.CLIENT_ID,
    redirectUri: process.env.REDIRECT_URI,
    scope: process.env.SCOPE || "User.Read",
    tenantId: process.env.TENANT_ID,
  });
}),

// obtiene el token de acceso
app.post("/auth/token", async (req, res) => {
  const { code, code_verifier } = req.body;
  if (!code || !code_verifier) {
    return res
      .status(400)
      .json({ error: "Missing code or code_verifier in request body" });
  }

  const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.REDIRECT_URI,
    code_verifier,
    client_secret: process.env.CLIENT_SECRET,
  });

  try {
    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json(tokenData);
    }

    res.status(200).json(tokenData);
  } catch (error) {
    console.error("Error getting token:", error);
    res.status(500).json({ error: "Error getting token" });
  }
});

// ========================= USUARIO PROPIO ==============================
// obtener el perfil del usuario
app.get("/user/profile", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("Error getting user profile:", error);
    res.status(500).json({ error: "Error getting user profile" });
  }
});

// obtener foto de perfil del usuario
app.get("/user/profile_pic", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/photo/$value",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      console.error("Error fetching photo:", response.statusText);
      return res
        .status(response.status)
        .json({ error: "Failed to fetch photo" });
    }

    // 📸 Leer el stream de la imagen correctamente
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ✅ Enviar la imagen correctamente con el tipo MIME adecuado
    res.setHeader("Content-Type", response.headers.get("Content-Type"));
    res.send(buffer);
  } catch (error) {
    console.error("Error getting user profile:", error);
    res.status(500).json({ error: "Error getting user profile" });
  }
});

// ========================= EVENTOS DE TODOS LOS USUARIOS ===============================
// obtener eventos del usuario
app.get("/user/:userId/events", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { userId } = req.params;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    // Consultar la BD para obtener el correo del empleado
    const db = await getDb();
    const row = await db.get("SELECT email FROM Employees WHERE id = ?", userId);
    if (!row || !row.email) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const email = row.email;

    // Usar el correo obtenido en la URL de Microsoft Graph
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/calendar/events?$filter=subject eq 'Vacaciones'`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("Error getting user events:", error);
    res.status(500).json({ error: "Error getting user events" });
  }
});

// ========================= TODOS LOS USUARIOS =============================
// Obtener los nombres de los usuarios
app.get("/user/:userId", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { userId } = req.params;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const db = await getDb();
    const row = await db.get("SELECT name FROM Employees WHERE id = ?", userId);
    if (!row || !row.name) {
      return res.status(404).json({ error: "Employee not found" });
    }
  
    const data = { name: row.name };
    res.json(data);
  
  } catch (error) {
    console.error("Error getting user:", error);
    res.status(500).json({ error: "Error getting user" });
  }
});

// Obtener foto de perfil de cada uno de los usuarios
app.get("/user/:userId/photo", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { userId } = req.params;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/photo/$value`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      return res.status(404).json({ error: "No profile picture found" });
    }

    const imageBuffer = await response.buffer();
    res.set("Content-Type", "image/jpeg");
    res.send(imageBuffer);
  } catch (error) {
    console.error("Error getting user photo:", error);
    res.status(500).json({ error: "Error getting user photo" });
  }
});

app.get("api/isAdmin", async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    const db = await getDb();
    const row = await db.get("SELECT admin FROM Employees WHERE email = ?", [email]);
    if (!row) {
      return res.status(404).json({ error: "Employee not found" });
    }
  
    res.json({ isAdmin: row.admin === 1 });
  } catch (error) {
    console.error("Error checking admin status:", error);
    res.status(500).json({ error: "Error checking admin status" });
  }
});

// ========================= DATABASE =============================
// Agregar un nuevo empleado
app.post("/employees", async (req, res) => {
    const { email, name, admin, departments } = req.body;
    console.log("Received data:", {
        email, name, admin, departments,
        adminType: typeof admin, departmentsType: typeof departments
    });

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    try {
        const db = await getDb();
        const adminValue = admin ? 1 : 0;

        const result = await runWithRetry(
          db,
          "INSERT INTO employees (email, name, admin) VALUES (?, ?, ?)",
          [email, name || null, adminValue]
        );

        const employeeId = result.lastID;
        console.log("Employee inserted with ID:", employeeId);

        // Procesar varios departamentos
        if (departments && Array.isArray(departments)) {
            for (const department of departments) {
                if (department && department !== 'undefined') {
                    console.log("Linking department:", department);
                    await runWithRetry(
                      db,
                      "INSERT INTO employeesDepartments (id_employee, id_department) VALUES (?, ?)",
                      [employeeId, department]
                    );
                    console.log("Department relationship created");
                }
            }
        } else if (departments && departments !== 'undefined') {
            // Por compatibilidad, si solo viene uno como string
            console.log("Linking department:", departments);
            await runWithRetry(
              db,
              "INSERT INTO employeesDepartments (id_employee, id_department) VALUES (?, ?)",
              [employeeId, departments]
            );
            console.log("Department relationship created");
        }

        res.status(201).json({
            message: "Employee added successfully",
            employeeId: employeeId
        });

    } catch (error) {
        console.error("Error adding employee:", error);
        res.status(500).json({ error: "Error adding employee: " + error.message });
    }
});

// obtiene la lista de empleados y sus departamentos desde SQLite
app.get("/employees", async (req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all(`
            SELECT 
              e.id AS employee_id,
              e.name AS name,
              e.email AS email,
              e.admin AS admin,
              d.department AS department
            FROM Employees e
            INNER JOIN EmployeesDepartments ed ON e.id = ed.id_employee
            INNER JOIN Departments d ON d.id = ed.id_department
            ORDER BY e.id;
        `);
        const employeesMap = new Map();

        for (const row of rows) {
            if (!employeesMap.has(row.employee_id)) {
                employeesMap.set(row.employee_id, {
                    id: row.employee_id,
                    name: row.name,
                    email: row.email,
                    admin: row.admin,
                    departments: [],
                });
            }
          employeesMap.get(row.employee_id).departments.push(row.department);
        }

        const result = Array.from(employeesMap.values());
        res.json(result);
    } catch (err) {
        console.error("Error getting employees:", err);
        res.status(500).json({ error: "Error getting employees" });
    }
});

// editar un empleado existente
app.put("/employees/:id", async (req, res) => {
  const { id } = req.params;
  const { email, name, admin, departments } = req.body;

  try {
    const db = await getDb();

    // Obtener los datos actuales
    const currentEmployee = await db.get("SELECT * FROM Employees WHERE id = ?", [id]);
    if (!currentEmployee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Usar valores nuevos si existen, sino mantener los actuales
    const updatedEmail = email ?? currentEmployee.email;
    const updatedName = name ?? currentEmployee.name;
    const updatedAdmin = typeof admin === "number" ? admin : currentEmployee.admin;

    // Actualizar datos del empleado
    await db.run(
      "UPDATE Employees SET email = ?, name = ?, admin = ? WHERE id = ?",
      [updatedEmail, updatedName, updatedAdmin, id]
    );

    // Solo modificar departamentos si se incluye en el body
    if (departments !== undefined) {
      // Borrar las relaciones antiguas
      await db.run("DELETE FROM EmployeesDepartments WHERE id_employee = ?", [id]);

      // Insertar nuevas relaciones
      const deptArray = Array.isArray(departments) ? departments : [departments];

      for (const deptName of deptArray) {
        const dept = await db.get("SELECT id FROM Departments WHERE department = ?", [deptName]);
        if (dept) {
          await db.run("INSERT INTO EmployeesDepartments (id_employee, id_department) VALUES (?, ?)", [
            id,
            dept.id
          ]);
        }
      }
    }

    res.status(200).json({ message: "Employee updated" });
  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({ error: "Error updating employee" });
  }
});

// Endpoint para obtener todos los departamentos existentes en la base de datos
app.get("/departments", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT id, department 
      FROM Departments 
      ORDER BY department;
    `);
    
    res.json(rows);
  } catch (err) {
    console.error("Error getting departments:", err);
    res.status(500).json({ error: "Error getting departments" });
  }
});

// añade un nuevo departamento
app.post("/departments", async (req, res) => {
  const { department } = req.body;
  if (!department) {
    return res.status(400).json({ error: "Deparment is required" });
  }

  try {
    const db = await getDb();
    await db.run("INSERT INTO Departments (department) VALUES (?)", [
      department || null,
    ]);
    res.status(201).json({ message: "Department added" });
  } catch (error) {
    console.error("Error adding department:", error);
    res.status(500).json({ error: "Error adding department" });
  }
});

// añade una nueva relación departamento/empleado
app.post("/employees_departments", async (req, res) => {
  const { id_employee, id_department } = req.body;
  if (!id_employee || !id_department) {
    return res.status(400).json({ error: "id_employee or id_department is required" });
  }

  try {
    const db = await getDb();
    await db.run("INSERT INTO EmployeesDepartments (id_employee, id_department) VALUES (?, ?)", [
      id_employee,
      id_department || null,
    ]);
    res.status(201).json({ message: "employees_departments added" });
  } catch (error) {
    console.error("Error adding department:", error);
    res.status(500).json({ error: "Error adding employees_departments" });
  }
});

// Elimina un empleado
app.delete("/employees/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const db = await getDb();

    // Verificar si el empleado existe
    const employee = await db.get("SELECT * FROM Employees WHERE id = ?", [id]);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Eliminar relaciones con departamentos
    await db.run("DELETE FROM EmployeesDepartments WHERE id_employee = ?", [id]);

    // Eliminar el empleado
    const result = await db.run("DELETE FROM Employees WHERE id = ?", [id]);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.status(200).json({ message: "Employee deleted" });
  } catch (error) {
    console.error("Error deleting employee:", error);
    res.status(500).json({ error: "Error deleting employee" });
  }
});

// Helper: Retry DB operations if busy
async function runWithRetry(db, sql, params = [], retries = 5, delay = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      return await db.run(sql, params);
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && i < retries - 1) {
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

