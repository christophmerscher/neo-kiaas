import { useEffect } from 'react';
import { VERSION } from '../constants';

/**
 * "Über neo-KIAS" modal — disclaimer, license, and unofficial-extension
 * notice. Dismissed via the X button, the "Verstanden" button, the
 * backdrop, or the ESC key.
 *
 * @param {{ onClose: () => void }} props
 */
export function InfoModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Schließen">×</button>
        <h2>
          Über <span className="logo-accent">neo-KIAS</span>
          <span className="version-badge">{VERSION}</span>
        </h2>
        <p className="modal-lead">
          Eine moderne, lokal laufende Web-Oberfläche zum Durchsuchen der KIAS-Datenbank.
        </p>

        <section>
          <h3>Inoffizielle Erweiterung</h3>
          <p>
            <strong>neo-KIAS ist eine inoffizielle Drittanbieter-Erweiterung.</strong> Dieses Projekt
            steht in keiner Verbindung zu Ford, der Ford-Werke GmbH oder einem ihrer
            Tochterunternehmen, Partner oder Lieferanten und wird von diesen weder unterstützt,
            gesponsert noch genehmigt.
          </p>
          <p>
            Der Name „KIAS" sowie alle weiteren genannten Produkt- oder Markennamen sind das
            Eigentum der jeweiligen Rechteinhaber und werden hier ausschließlich zur Beschreibung
            der Datenquelle verwendet.
          </p>
          <p>
            Die zugrunde liegenden Daten (DBF-/FPT-Dateien) müssen vom Nutzer selbst bereitgestellt
            werden. neo-KIAS liest diese rein lesend ein und überträgt keine Daten an externe
            Server.
          </p>
        </section>

        <section>
          <h3>Haftungsausschluss</h3>
          <p>
            <strong>
              Diese Software wird ohne jegliche Gewährleistung bereitgestellt – weder ausdrücklich
              noch stillschweigend.
            </strong>{' '}
            Die Nutzung erfolgt vollständig auf eigene Gefahr.
          </p>
          <p>
            In keinem Fall haften die Autoren oder Urheberrechtsinhaber für direkte, indirekte,
            zufällige, besondere, exemplarische oder Folgeschäden (einschließlich, aber nicht
            beschränkt auf Beschaffung von Ersatzgütern oder ‑leistungen, Nutzungs‑, Daten‑ oder
            Gewinnausfall oder Betriebsunterbrechung), die sich aus der Nutzung dieser Software
            ergeben – auch dann nicht, wenn auf die Möglichkeit solcher Schäden hingewiesen wurde.
          </p>
          <p>
            Insbesondere übernehmen die Autoren keine Verantwortung für Fehlinterpretationen,
            falsche Reparaturen, Beschädigungen an Fahrzeugen oder Personen, finanzielle Verluste
            oder rechtliche Konsequenzen, die durch Nutzung der durch neo-KIAS angezeigten
            Informationen entstehen können. Maßgeblich sind stets die offiziellen Hersteller­unterlagen.
          </p>
        </section>

        <section>
          <h3>Lizenz</h3>
          <p>
            Veröffentlicht unter der <strong>MIT-Lizenz</strong>. Der vollständige Lizenztext
            befindet sich in der Datei <code>LICENSE</code> im Projekt-Verzeichnis.
          </p>
          <pre className="license-block">{`MIT License

Copyright (c) ${new Date().getFullYear()} neo-KIAS contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`}</pre>
        </section>

        <div className="modal-actions">
          <button className="modal-primary" onClick={onClose}>Verstanden</button>
        </div>
      </div>
    </div>
  );
}
