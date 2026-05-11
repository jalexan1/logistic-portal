import React, { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

// ── BD Clientes — generada desde BD_clientes.xlsx ──
// Estructura: nit → { nombre, ciudad }
const BD_CLIENTES = {
  "1007316192": { nombre: "Maria Isabel Gonzalez Cardona", ciudad: "Chigorodó" },
  "1012327648": { nombre: "Luna Lizeth Roa Berrio", ciudad: "Facatativá" },
  "1018496555": { nombre: "Laura Cruz Paez", ciudad: "Bogotá, D.C." },
  "1020769308": { nombre: "Natalia Hernandez", ciudad: "San Andrés" },
  "1026263752": { nombre: "MARTINA GALVIS FLOREZ", ciudad: "Mapiripán" },
  "1038106362": { nombre: "Marly Mejía Calle", ciudad: "Caucasia" },
  "1075794709": { nombre: "Sara Galindo", ciudad: "Neiva" },
  "1085312823": { nombre: "Mario Andres Munoz Ceron", ciudad: "Orito" },
  "1090488079": { nombre: "Maria Fernanda Duarte Garcia", ciudad: "Cúcuta" },
  "1112785941": { nombre: "Natalia Valencia", ciudad: "Cartago" },
  "1121932662": { nombre: "Laura Alejandra Enciso", ciudad: "Granada" },
  "1124994805": { nombre: "Zulay Vasquez", ciudad: "Villavicencio" },
  "1146434663": { nombre: "Sara Alvarez", ciudad: "Envigado" },
  "2100374715": { nombre: "Genesis Reyes Velez", ciudad: "LA HORMIGA" },
  "25196657": { nombre: "Emilsen Taborda Granada", ciudad: "Istmina" },
  "30389726": { nombre: "Sandra Zaraza", ciudad: "La Dorada" },
  "32349370": { nombre: "Tatiana Orozco", ciudad: "Itagüí" },
  "39796469": { nombre: "Janeth Arias", ciudad: "Bogotá, D.C." },
  "901262219": { nombre: "Ilusion De La Belleza", ciudad: "Medellín" },
  "901844848": { nombre: "Comercializadora e Inversiones DJR SAS", ciudad: "Valledupar" },
  "901856110": { nombre: "Nicoll Vanegas", ciudad: "Medellín" },
  "902033359": { nombre: "ARNEDY LUZ AVILA - KAMALA GROUP SAS", ciudad: "cajica" },
  "901996845": { nombre: "Sandra Milena Ceron", ciudad: "Cali" },
  "901871095": { nombre: "Inversiones Y Soluciones Jbc", ciudad: "Cartagena de Indias" },
  "901507447": { nombre: "COSMAGIC SAS", ciudad: "Bogotá, D.C." },
  "41945561": { nombre: "Liliana Ester Correa Yepes", ciudad: "Armenia" },
  "365149982": { nombre: "Melissa Latam Smart 5pl Llc", ciudad: "Medellín" },
  "30722869": { nombre: "Angela Burbano", ciudad: "Pasto" },
  "24694870": { nombre: "Gloria Yamile Londono Florez", ciudad: "Dosquebradas" },
  "20423816": { nombre: "Luz Eliana Diaz Venegas", ciudad: "Cajicá" },
  "1193545017": { nombre: "Daniela Lopez Giraldo", ciudad: "Villavicencio" },
  "1233689950": { nombre: "Daniela Cancelada González", ciudad: "Bogotá, D.C." },
  "1152450893": { nombre: "Liliana Maria Pulgarin Bedoya", ciudad: "Medellín" },
  "1126128743": { nombre: "Jhonnathans Guerrero", ciudad: "Cúcuta" },
  "1118204016": { nombre: "Geraldine Hormaza", ciudad: "Zipaquirá" },
  "1114001104": { nombre: "Valeria Trujillo Marin", ciudad: "Dosquebradas" },
  "1093791155": { nombre: "Yarly Araque", ciudad: "Cúcuta" },
  "1085320468": { nombre: "Jhanny Segura Narvaez", ciudad: "Pasto" },
  "1090474246": { nombre: "Everson Rodríguez", ciudad: "El Rosal" },
  "1075260473": { nombre: "Mariana Angelica Ramos Correa", ciudad: "Neiva" },
  "1072747429": { nombre: "Angy Sanchez", ciudad: "Guaduas" },
  "1061771434": { nombre: "Yenni Bravo", ciudad: "Popayán" },
  "1044921336": { nombre: "Sigrid Lopez Lopez", ciudad: "Arjona" },
  "1053805170": { nombre: "Yuliana Munoz Escobar", ciudad: "Dosquebradas" },
  "1037629491": { nombre: "Paola Zapata Rios", ciudad: "Envigado" },
  "1028018882": { nombre: "Erika Julieth Mena Benitez", ciudad: "Apartadó" },
  "1034310325": { nombre: "Jose Carvajalino", ciudad: "Bogotá, D.C." },
  "1022382138": { nombre: "Lisseth Melissa Suarez Ruiz", ciudad: "Bogotá, D.C." },
  "1015414820": { nombre: "Catalina Baron Aranguren", ciudad: "Villanueva" },
  "1016953214": { nombre: "Danna Osorio Bareno", ciudad: "Barrancabermeja" },
  "1004967098": { nombre: "Natalia Osorio", ciudad: "Cúcuta" },
  "1052838346": { nombre: "Laura Catalina Cardenas Acevedo", ciudad: "Bogotá, D.C." },
  "1072710019": { nombre: "Luisa Fernanda Betancourt Piedrahita", ciudad: "Roldanillo" },
  "1112165530": { nombre: "Alexandra Rico Velez", ciudad: "Guadalajara de Buga" },
  "1110588433": { nombre: "Valentina Rodriguez", ciudad: "Ibagué" },
  "1143327457": { nombre: "Yineth Quintana Martirnez", ciudad: "Ipiales" },
  "1116437042": { nombre: "Lina Marcela Montenegro Echeverri", ciudad: "Zarzal" },
  "1120353896": { nombre: "Daniela Correa", ciudad: "Puerto López" },
  "1042445716": { nombre: "Risorozco Orozco Camargo", ciudad: "Soledad" },
  "1053850370": { nombre: "ESTEFANIA GAVIRIA MIRANDA", ciudad: "Bogotá, D.C." },
  "1005851999": { nombre: "Carolina Padilla", ciudad: "Bogotá, D.C." },
  "1006005310": { nombre: "Solanyi Bermudez Reinoso", ciudad: "Rovira" },
  "1014596312": { nombre: "Tatiana Patino Castro", ciudad: "Bogotá, D.C." },
  "1022423059": { nombre: "Lina Alejandra Diaz", ciudad: "Bogotá, D.C." },
  "1020761226": { nombre: "Simon Escobar Hoyos", ciudad: "Líbano" },
  "1192716334": { nombre: "Jhary Tatiana Calderon Rodriguez", ciudad: "Saravena" },
  "15441517": { nombre: "Leonardo Alberto Martinez Guarin", ciudad: "Antioquia" },
  "1024566822": { nombre: "Daniela Marín Bustamante", ciudad: "Cundinamarca" },
  "1007417914": { nombre: "Santiago Agudelo Perez", ciudad: "Antioquia" },
  "1004682009": { nombre: "Mariana Guapacha", ciudad: "Risaralda" },
  "1000118530": { nombre: "Adriana Romero", ciudad: "Bogotá, D.C." },
  "1061758173": { nombre: "Anggie Hoyos Rincon", ciudad: "Cauca" },
  "1088356335": { nombre: "Nayibe Stefany Bernal", ciudad: "Risaralda" },
  "1044506590": { nombre: "Luisa Fernanda Mazo Chavarría", ciudad: "Yarumal" },
  "1073823627": { nombre: "Dayana Gomez Galvis", ciudad: "San Pelayo" },
  "1117543683": { nombre: "Mayerli Andrea Imbachi Lugo", ciudad: "Florencia" },
  "1151960970": { nombre: "Karen Dayana Arenas", ciudad: "Palmira" },
  "1001504884": { nombre: "Melisa Puerta Pulgarin", ciudad: "Itagüí" },
  "1005911254": { nombre: "Laura Guzman", ciudad: "Ibagué" },
  "1007325976": { nombre: "Andrea Roldan", ciudad: "Medellin" },
  "1026587489": { nombre: "Juliana Ruiz", ciudad: "Bogotá, D.C." },
  "1037072363": { nombre: "Manuela Mejia Ciro", ciudad: "San Rafael" },
  "1233189579": { nombre: "Erika Natalia Ibarra Guerrero", ciudad: "Pasto" },
  "37122226": { nombre: "Ximena Lopez Osorio", ciudad: "Ipiales" },
  "47188326": { nombre: "Fabiola Georgette Rojas Otero", ciudad: "Ipiales" },
  "60283973": { nombre: "Blanca Ligia Silva Pedraza", ciudad: "Pamplona" },
  "70692665": { nombre: "Angie Paola Giraldo Dueque", ciudad: "Bogotá, D.C." },
  "900880568": { nombre: "Print And Colors S A S", ciudad: "Medellin" },
  "8110252891": { nombre: "NOVAVENTA", ciudad: "el carmen de Viboral" },
  "901549954": { nombre: "H&C S.A.S", ciudad: "Medellín" },
  "39447700": { nombre: "Cristina Durango", ciudad: "Rionegro" },
  "39651003": { nombre: "MARIA CECILIA SANCHEZ DUQUE", ciudad: "Medellín" },
  "24023091": { nombre: "Sonia Judith Abril Barreto", ciudad: "Bogotá, D.C." },
  "1014285421": { nombre: "Yenifer Lorena Rodriguez Higuera", ciudad: "Bogotá, D.C." },
  "1017255758": { nombre: "Claudia Andres Arias Alzate", ciudad: "Medellín" },
  "1018438922": { nombre: "Viviana Paola Suarez Suarez", ciudad: "Bogotá, D.C." },
  "1002922776": { nombre: "Daniela Cordoba Zuniga", ciudad: "El Tambo" },
  "1143973284": { nombre: "Luisa Fernanda Rubiano Castaneda", ciudad: "Cali" },
  "1123633011": { nombre: "Chabelis Ortiz", ciudad: "San Andrés" },
  "1121903376": { nombre: "Katherine Tatiana Rincon", ciudad: "Villavicencio" },
  "1116914929": { nombre: "Yina Marcela Pena Agudelo", ciudad: "El Doncello" },
  "1110285296": { nombre: "Beiry Paola Alzate", ciudad: "Cali" },
  "1073516353": { nombre: "Rocio Larrota Neisa", ciudad: "Mosquera" },
  "1062276728": { nombre: "Yeny Sorani Jimenez", ciudad: "Jamundí" },
  "1086697752": { nombre: "Diana Zambrano Tobar", ciudad: "CUMBITARA" },
  "1088328209": { nombre: "Eliana Villa", ciudad: "Dosquebradas" },
  "1096483359": { nombre: "Marlen Velazco Olaya", ciudad: "Landázuri" },
  "1058932239": { nombre: "Jennifer Carolina Munoz Delgado", ciudad: "Pitalito" },
  "1110565833": { nombre: "Maribel Rodriguez Anzola", ciudad: "Puerto Salgar" },
  "1112101020": { nombre: "Manuela Ramirez", ciudad: "Jamundí" },
  "1006778567": { nombre: "Claudia Gutierrez", ciudad: "Acacías" },
  "1018477239": { nombre: "Eliana Maria Salazar Jimenez", ciudad: "Bogotá, D.C." },
  "24253456": { nombre: "Yaksibeth Garcia", ciudad: "Maicao" },
  "37335103": { nombre: "Aura Esthella Ortega Trigos", ciudad: "Ocaña" },
  "43188449": { nombre: "JURANNY RODRIGUEZ VARGAS", ciudad: "Floridablanca" },
  "901455091": { nombre: "Comercializadora Modaybelleza Castro", ciudad: "Bucaramanga" },
  "66873539": { nombre: "Beatriz Eugenia Silva Laverde", ciudad: "Roldanillo" },
  "890941663": { nombre: "DISTRIBUIDORA PASTEUR S.A.", ciudad: "Itagui" },
  "901940036": { nombre: "Carolina Pico Figueredo", ciudad: "Chía" },
  "46454566": { nombre: "Derli Paulid Silva Ascencio", ciudad: "Duitama" },
  "52501147": { nombre: "Maria Nelly Gonzalez Avila", ciudad: "Bogotá, D.C." },
  "37724554": { nombre: "Alejandra Torres", ciudad: "Bucaramanga" },
  "38683496": { nombre: "Melida Orozco Otero", ciudad: "Cali" },
  "24713246": { nombre: "Ivonne Rocio Rodriguez", ciudad: "Fresno" },
  "30050086": { nombre: "Mariela Ortiz Caballero", ciudad: "Cúcuta" },
  "1192771184": { nombre: "Maria Paula Zuluaga Botero", ciudad: "Bogotá, D.C." },
  "1019017927": { nombre: "Carlos Andres Orozco Botero", ciudad: "Granada" },
  "1017263423": { nombre: "Valentina Osorio Marin", ciudad: "La Estrella" },
  "1006856845": { nombre: "Laura Jimena Laguna Laura Jimena Laguna Martinez", ciudad: "Villanueva" },
  "1006130847": { nombre: "MARÍA JOSÉ RODRÍGUEZ CAMPOS", ciudad: "Ibagué" },
  "1006100709": { nombre: "Isabella Marquez Plaza", ciudad: "Santiago de Cali" },
  "1000105414": { nombre: "Karen Gonzalez Monsalve", ciudad: "Santa Fé de Antioquia" },
  "1036949492": { nombre: "Julieth Vanessa Montoya Marin", ciudad: "Rionegro" },
  "1034779250": { nombre: "Eimy Valentina Paez Gutierrez", ciudad: "Bogotá, D.C." },
  "1020471594": { nombre: "Fernanda Rodriguez", ciudad: "Bello" },
  "1110452623": { nombre: "YOHANA ALEJANDRA COMBA CRINSTANCHO", ciudad: "Ibagué" },
  "1121939949": { nombre: "Zully Esmeralda Rodriguez Trujillo", ciudad: "Villavicencio" },
  "1118198743": { nombre: "Jeisson Fernando Diaz Romero", ciudad: "Villanueva" },
  "1130679676": { nombre: "Natalia Rodriguez Ortiz", ciudad: "Bogotá, D.C." },
  "1140836083": { nombre: "Laura Stefanie Alvarado Lamar", ciudad: "Barranquilla" },
  "1144094217": { nombre: "Marien Lizeth Salazar Munoz", ciudad: "Santiago de Cali" },
  "1055314606": { nombre: "XIOMARA RAMIREZ", ciudad: "Tibasosa" },
  "1047491387": { nombre: "Steven Puerta Campo", ciudad: "Cartagena de Indias" },
  "1045742255": { nombre: "Maria Coronado Durango", ciudad: "Barranquilla" },
  "1061720156": { nombre: "Zared Ortega Rodríguez", ciudad: "Popayán" },
  "1077450197": { nombre: "Cristina Perez Lopez", ciudad: "Quibdó" },
  "1097039314": { nombre: "Laura Hernandez", ciudad: "Quimbaya" },
  "1086755436": { nombre: "Lisbeth Magaly Quiroz Usama", ciudad: "Pasto" },
  "1083894682": { nombre: "Laura Valentina Rodriguez Urbano", ciudad: "Pitalito" },
  "1084848149": { nombre: "Tatiana Patricia Albear Chamorro", ciudad: "Ipiales" },
  "1090486131": { nombre: "Josseph Arevalo Ardila", ciudad: "Cúcuta" },
  "1090432960": { nombre: "Yaritza Castro", ciudad: "San José de Cúcuta" },
  "1081277601": { nombre: "Camila Martinez", ciudad: "Valle del Guamuez" },
  "1090986717": { nombre: "KAREN LISBETH PÉREZ", ciudad: "Ibagué" },
  "1091383585": { nombre: "Valeska Lathulerie", ciudad: "Villa del Rosario" },
  "1070989269": { nombre: "Sara Chacon Agudelo", ciudad: "Facatativá" },
  "1069178131": { nombre: "Valentina Alvarez Ortiz", ciudad: "Flandes" },
  "1140881437": { nombre: "Sor Beatriz Orozco Sanchez", ciudad: "Barranquilla" },
  "1128391156": { nombre: "Daniel Fernando Lopez Umanana", ciudad: "Medellín" },
  "1123801775": { nombre: "SIMON RUIZ BACCA", ciudad: "Villavicencio" },
  "1126323155": { nombre: "Mikael Parent Zapata", ciudad: "Rionegro" },
  "1121826665": { nombre: "Marcela Rodriguez Torres", ciudad: "Villavicencio" },
  "1121855749": { nombre: "Maria Del Pilar Diaz Acosta", ciudad: "Villavicencio" },
  "1122137467": { nombre: "Yesica Alexandra Martínez useche", ciudad: "Acacías" },
  "1118551744": { nombre: "Deisy Johanna Tejedor Cordoba", ciudad: "Yopal" },
  "1116260277": { nombre: "Paola Tejada", ciudad: "Tuluá" },
  "1113664248": { nombre: "Nelly Fernanda Diaz Villegas", ciudad: "Palmira" },
  "1105787237": { nombre: "Edna Boada Aguilera", ciudad: "Ibagué" },
  "1107837758": { nombre: "Valentina Bernal Mejia", ciudad: "Candelaria" },
  "1023029368": { nombre: "Jolainy Garibello", ciudad: "Bogotá, D.C." },
  "1032469036": { nombre: "Paula Lizeth Hernandez Galindo", ciudad: "Bogotá, D.C." },
  "1035914797": { nombre: "Estefania Gomez", ciudad: "Guarne" },
  "1036223866": { nombre: "Yeni Katerine Amaya Aisales", ciudad: "Puerto Triunfo" },
  "1036606786": { nombre: "Jenny Alexandra Berrio de Ossa", ciudad: "Medellín" },
  "1036925114": { nombre: "Monica Milany Valencia Duque", ciudad: "Rionegro" },
  "1038335893": { nombre: "Luisa Fernandez Herrera Garcia", ciudad: "Frontino" },
  "1039455502": { nombre: "Norman Yecid Arias Giraldo", ciudad: "Medellín" },
  "1000857707": { nombre: "Angie Tatiana Cobos Barrantes", ciudad: "Soacha" },
  "1001089847": { nombre: "Andrea Rojas Rincon", ciudad: "Girardot" },
  "1006735541": { nombre: "Lina Marcela Vega Arrieta", ciudad: "Valledupar" },
  "1007115199": { nombre: "Brahian Alexis Botero Botero", ciudad: "medellin" },
  "1007757377": { nombre: "Yeisi Restrepo", ciudad: "Funza" },
  "1014656224": { nombre: "Stephania Castiblanco Yepes", ciudad: "Soacha" },
  "1192781775": { nombre: "Suzana Sanchez", ciudad: "Turbo" },
  "1193079739": { nombre: "Anyela Jimenez Botero", ciudad: "El Dovio" },
  "26337275": { nombre: "Yojanna Andrade", ciudad: "Cúcuta" },
  "23409809": { nombre: "Anastasia Poletti", ciudad: "San José de Cúcuta" },
  "16752714": { nombre: "MARTIN RAGA TRUJILLO", ciudad: "Santiago de Cali" },
  "40045996": { nombre: "Paola Forero", ciudad: "Tunja" },
  "70698216": { nombre: "Daniel Humberto Martinez", ciudad: "Medellín" },
  "70828339": { nombre: "Eudin DE JESUS López Aristizabal", ciudad: "Medellín" },
  "51865795": { nombre: "Olga Sobeida Cifuente Gonzales", ciudad: "Duitama" },
  "52102673": { nombre: "Carmen Hernandez", ciudad: "Bogotá, D.C." },
  "901920870": { nombre: "Dayro Ramirez", ciudad: "Rionegro" },
  "902000986": { nombre: "Baia Beauty Sas", ciudad: "Bogotá, D.C." },
  "942492695": { nombre: "Nury Jeomayra Vega Ramirez", ciudad: "Ipiales" },
  "69891856": { nombre: "Giselys Vivas Pacheco", ciudad: "La Estrella" },
  "901497746": { nombre: "MAGNA COSMETICS SAS", ciudad: "Bogotá, D.C." },
  "901739561": { nombre: "Astrid Mateus Granados", ciudad: "Zipaquirá" },
  "901800537": { nombre: "Camila Gonzales", ciudad: "Ibagué" },
  "901705567": { nombre: "Diana Soler", ciudad: "Tunja" },
  "8363058": { nombre: "Luis Ferney Hurtado", ciudad: "Medellín" },
  "63324974": { nombre: "Martha Cecilia Lopez velazco", ciudad: "Bucaramanga" },
  "900313153": { nombre: "SAMARA COSMETICS S.A.S", ciudad: "ITAGUI" },
  "901881981": { nombre: "DAYANASTILO SAS", ciudad: "Barranquilla" },
  "47429871": { nombre: "Ana Yaneth Cardenas", ciudad: "Medellín" },
  "52603399": { nombre: "Heidy Paola Velasquez Bautista", ciudad: "Pacho" },
  "42018646": { nombre: "Victoria Jaramillo Correa", ciudad: "Dosquebradas" },
  "40443366": { nombre: "Lucila Ospitia Sosa", ciudad: "Villavicencio" },
  "37256897": { nombre: "Lilia Del Socorro Quintero Contreras", ciudad: "Cúcuta" },
  "35427045": { nombre: "Viviana Gomez", ciudad: "Zipaquirá" },
  "20500197": { nombre: "Leidy Adriana Rodriguez Sanabria", ciudad: "Sopó" },
  "26631382": { nombre: "Maria Nila Bermeo", ciudad: "Garzón" },
  "28151962": { nombre: "Jackeline Contreras Rico", ciudad: "Pamplona" },
  "29670972": { nombre: "Katherine Ortiz Osorio", ciudad: "Cota" },
  "29684926": { nombre: "Cristina Isabel Pantoja Bonilla", ciudad: "Palmira" },
  "30403567": { nombre: "Angelica Maria Sanchez", ciudad: "Bogotá, D.C." },
  "1152209715": { nombre: "Maria Alejandra Restrepo", ciudad: "Andes" },
  "1234188013": { nombre: "Angie Paola Gomez", ciudad: "Ibagué" },
  "1015451902": { nombre: "Monica Rivera Montoya", ciudad: "Bogotá, D.C." },
  "1016051882": { nombre: "Carolina Rodriguez", ciudad: "Bogotá, D.C." },
  "1016085478": { nombre: "Ginna Marcela Angel Gutierrez", ciudad: "Bogotá, D.C." },
  "1017150913": { nombre: "DIANA CAROLINA MONTOYA", ciudad: "Montería" },
  "1017206200": { nombre: "Paula Andrea Quintero Soto", ciudad: "Medellín" },
  "1017238260": { nombre: "Estefania Barrera Arteaga", ciudad: "Medellín" },
  "1010102243": { nombre: "Sirehydi Daniela Bonilla Gelvez", ciudad: "Bogotá, D.C." },
  "1006904586": { nombre: "DEISY GUZMÁN", ciudad: "Lejanías" },
  "1006846150": { nombre: "Lisette Nellyana Quintana Gomez", ciudad: "Puerto Asís" },
  "1006433404": { nombre: "Gabriela Escalante Villada", ciudad: "Santiago de Cali" },
  "1005691812": { nombre: "Jimena Chaparro", ciudad: "Ibagué" },
  "1003966256": { nombre: "Manuela Cuellar", ciudad: "Pitalito" },
  "1004417675": { nombre: "Yerlit Lorena Otaya Maje", ciudad: "Medellín" },
  "1001443339": { nombre: "Natalia Villegas Marin", ciudad: "Puerto Triunfo" },
  "1038547523": { nombre: "Andrea Rojas Rodriguez", ciudad: "Remedios" },
  "1038813495": { nombre: "Cindy Arroyo Nino", ciudad: "Chigorodó" },
  "1039703779": { nombre: "PAULA ANDREA LÓPEZ YEPEZ", ciudad: "Puerto Berrío" },
  "1042065282": { nombre: "Carolina Hernandez Quiroz", ciudad: "Caldas" },
  "1036934158": { nombre: "Juliana Vanessa Parra Zapata", ciudad: "Rionegro" },
  "1038137772": { nombre: "Dayana Santos Montesino", ciudad: "Caucasia" },
  "1036670057": { nombre: "Alejandra Acevedo Ladino", ciudad: "Itagüí" },
  "1036393950": { nombre: "Yuli Zuluaga M", ciudad: "Medellín" },
  "1035303904": { nombre: "Ana Maria Montoya Ramirez", ciudad: "Cañasgordas" },
  "1035430319": { nombre: "Yenifer Pineda Gomez", ciudad: "Copacabana" },
  "1026270607": { nombre: "MARIA DE LOS ANGELES DIAZ GUTIERREZ", ciudad: "Bogotá, D.C." },
  "1026572008": { nombre: "Steffanni Bohorquez", ciudad: "Bogotá, D.C." },
  "1030540124": { nombre: "Maria Fernanda Reyes Pinzon", ciudad: "Bogotá, D.C." },
  "1022945067": { nombre: "Katerine Gamez", ciudad: "Bogotá, D.C." },
  "1026131745": { nombre: "Natalia Granados Arboleda", ciudad: "Sabaneta" },
  "1020480999": { nombre: "Paola Henao Florez", ciudad: "Bello" },
  "1110572860": { nombre: "Maria Camila Lozano Guzman", ciudad: "Ibagué" },
  "1110581298": { nombre: "Angela Patricia Marroquin Espinosa", ciudad: "Rovira" },
  "1112782767": { nombre: "Manuela Valencia", ciudad: "Cartago" },
  "1113307690": { nombre: "Lisset Valencia", ciudad: "Sevilla" },
  "1115423587": { nombre: "Valentina López cardona", ciudad: "Toro" },
  "1121715303": { nombre: "Linsy Rodriguez", ciudad: "San Andrés de Tumaco" },
  "1122652815": { nombre: "Pilar Suarez", ciudad: "Restrepo" },
  "1124833455": { nombre: "Ingrid Rueda", ciudad: "Villavicencio" },
  "1130671047": { nombre: "Isabella Lotero", ciudad: "Santiago de Cali" },
  "1144082304": { nombre: "PATRICIA NARVAEZ", ciudad: "Santiago de Cali" },
  "1151940994": { nombre: "Yohis Ciro Jimenez", ciudad: "Amalfi" },
  "1077634652": { nombre: "Jasmin Montes", ciudad: "Buenaventura" },
  "1077446611": { nombre: "Arely Marcela Montaño Cano", ciudad: "Quibdó" },
  "1072671350": { nombre: "Luisa Maria Pena Carvajal", ciudad: "Chía" },
  "1075256341": { nombre: "Karla Maria Torres Cuellar", ciudad: "Neiva" },
  "1061758407": { nombre: "ANGIE FERNANDA GAVIRIA", ciudad: "Popayán" },
  "1053824733": { nombre: "Angela Bibiana Rios Villa", ciudad: "Manizales" },
  "1090519755": { nombre: "Astrid Carolina Rodriguez Ferrer", ciudad: "Cúcuta" },
  "1093588480": { nombre: "DIANA VALENTINA SOLER", ciudad: "Cúcuta" },
  "1085947542": { nombre: "Angie Milena Taticuan Carlosama", ciudad: "Ipiales" },
  "1085253889": { nombre: "Alejandra Lasso Dorado", ciudad: "Pasto" },
  "109872979": { nombre: "Frankin Eduardo López Florez", ciudad: "Bucaramanga" },
  "1075236230": { nombre: "Yudy Pulido0909", ciudad: "Neiva" },
  "1124031358": { nombre: "Martha andreina Saavedra vale", ciudad: "Barranquilla" },
  "1032678598": { nombre: "Zharick Mileidy Hernandez Ocampo", ciudad: "Ibagué" },
  "1033727916": { nombre: "Brayan Fonseca", ciudad: "Bogotá, D.C." },
  "1030663674": { nombre: "Wendy Dayana Aguilar Max", ciudad: "Bogotá, D.C." },
  "1006692400": { nombre: "Angie Camila Trujillo Restrepo", ciudad: "Granada" },
  "1007542491": { nombre: "Distribuidora De Belleza 3g Glow", ciudad: "Garagoa" },
  "29284824": { nombre: "Andrea Saavedra Gonzalez", ciudad: "Yotoco" },
  "34564794": { nombre: "Laura Valentina Burbano", ciudad: "Popayán" },
  "36303171": { nombre: "Laura Tovar", ciudad: "Neiva" },
  "901808702": { nombre: "Buho Pink Multimarcas", ciudad: "Bogotá, D.C." },
  "901933300": { nombre: "Kioskito Beauty Sas", ciudad: "Pasto" },
  "99999999-9": { nombre: "ROSA MARIA HERNANDEZ", ciudad: "MONTERREY" },
  "901639989": { nombre: "Jennifer Norena Salazar", ciudad: "Armenia" },
  "901501576": { nombre: "Variedades H Y S S.A.S", ciudad: "Medellín" },
  "901566593": { nombre: "Maria Camila Hernandez", ciudad: "Itagüí" },
  "901181946": { nombre: "CREAFA SAS", ciudad: "Medellín" },
  "8358587": { nombre: "Maria Lorena Hoyos Aristizabal", ciudad: "EL SANTUARIO" },
  "901945530": { nombre: "MILANICO CORP SAS", ciudad: "San Andrés de Tumaco" },
  "23131267": { nombre: "Carmen Elizabeth Escalante Contreras", ciudad: "San José de Cúcuta" },
  "31880408": { nombre: "Cielo Ruth Valencia Hernandez", ciudad: "Santiago de Cali" },
  "39881878": { nombre: "Maria Alejandra Lambis Castilla", ciudad: "Arjona" },
  "116850872": { nombre: "Sofia Nunez Araya", ciudad: "Bogotá, D.C." },
  "1144200633": { nombre: "Laura Tobon", ciudad: "Cali" },
  "1007326615": { nombre: "Daniela Betancourt", ciudad: "El Banco" },
  "1014289605": { nombre: "Luisa Fernanda Palacios Garcia", ciudad: "Bogotá, D.C." },
  "1014192079": { nombre: "Antonio Garzón Rios", ciudad: "Fusagasugá" },
  "1000775234": { nombre: "Julieth Natalia Plazas Acuestas", ciudad: "Bogotá, D.C." },
  "1000285509": { nombre: "Santiago Pinzon", ciudad: "Chía" },
  "1000394369": { nombre: "VALENTINA CUERVO MONTOYA", ciudad: "Medellín" },
  "1000534056": { nombre: "Paola Lopez", ciudad: "Itagüí" },
  "1022390489": { nombre: "Andrea Celemin", ciudad: "Bogotá, D.C." },
  "1023526434": { nombre: "Juanita Santacruz", ciudad: "Puerto Boyacá" },
  "1023962833": { nombre: "Karol Julieth Mora Vargas", ciudad: "Bogotá, D.C." },
  "1037584059": { nombre: "Hector Dario Parra Marin", ciudad: "Envigado" },
  "1040571640": { nombre: "Mehily Angelin Davila Lopez", ciudad: "Bello" },
  "1040756823": { nombre: "Camila Orrego", ciudad: "Sabaneta" },
  "1127236575": { nombre: "Maria Jose Montenegro Montoya", ciudad: "Medellín" },
  "1144062835": { nombre: "Leydi Laura Linares Riano", ciudad: "Santiago de Cali" },
  "1105679659": { nombre: "Vanessa Munoz", ciudad: "Bogotá, D.C." },
  "1059910813": { nombre: "Mónica Alejandra Solano Daza", ciudad: "Popayán" },
  "1047499672": { nombre: "Angie paola ceballo martinez", ciudad: "Cartagena de Indias" },
  "1093781293": { nombre: "Andrea Vega", ciudad: "Cúcuta" },
  "1088270261": { nombre: "Katherine Arias", ciudad: "Pereira" },
  "1081415033": { nombre: "Hernan Camilo Chavarro Vasquez", ciudad: "Neiva" },
  "1096041114": { nombre: "Lili Tatiana Morales Andrade", ciudad: "La Tebaida" },
  "1102867168": { nombre: "Sandra Paola Sierra Ramirez", ciudad: "Sincelejo" },
  "1143467625": { nombre: "Alejandra Rangel Jacome", ciudad: "Barranquilla" },
  "1124994625": { nombre: "Irene Lucia Torres infante", ciudad: "Puerto Carreño" },
  "1038802018": { nombre: "Belleza De Lujo Diaz Pena", ciudad: "Chigorodó" },
  "1038100538": { nombre: "Yessica Rodriguez", ciudad: "Caucasia" },
  "1020432582": { nombre: "Marcela Osorio", ciudad: "Bello" },
  "1016044970": { nombre: "Daniel Castro", ciudad: "Funza" },
  "1020817096": { nombre: "ALEJANDRA PULIDO CRUZ", ciudad: "Bogotá, D.C." },
  "1000757943": { nombre: "Sirley Daniela Londono Taborda", ciudad: "Medellín" },
  "1005222024": { nombre: "Nesly Yelizza Pardo Torres", ciudad: "San Alberto" },
  "1006119183": { nombre: "Karen Natalia Nivia Cifuentes", ciudad: "Ibagué" },
  "39455030": { nombre: "Yamile Garcia Valencia", ciudad: "Rionegro" },
  "52449660": { nombre: "Luisa Fernanda Rozo Morera", ciudad: "Bogotá, D.C." },
  "901927640": { nombre: "Maria De Los Santos Mendoza", ciudad: "Medellín" },
  "91183559": { nombre: "Gonzalo Parra", ciudad: "Cúcuta" },
  "900464794": { nombre: "INVERSIONES KAUTIVA S.A.S", ciudad: "medellin" },
  "901480050": { nombre: "Beauty Pro Colombia Sas", ciudad: "Bogotá, D.C." },
  "9014438660": { nombre: "CLICK RIONEGRO", ciudad: "RIONEGRO" },
  "901760922": { nombre: "Inversiones Cosmeticos Herca", ciudad: "Bucaramanga" },
  "901763890-0": { nombre: "PLURAL LAB S.A.S.", ciudad: "SABANETA" },
  "900615349": { nombre: "Bellprof Group S.A.S", ciudad: "Barranquilla" },
  "901253562": { nombre: "Holy Cosmetics Sas", ciudad: "Bogotá, D.C." },
  "901280233": { nombre: "Eliana Giraldo", ciudad: "Medellín" },
  "63501976": { nombre: "Rocio Galeano", ciudad: "Bogotá, D.C." },
  "901900121": { nombre: "Inversiones bellas sas", ciudad: "Valledupar" },
  "43098492": { nombre: "Luz Estela Roldan Velasquez", ciudad: "Envigado" },
  "32840919": { nombre: "Ingrid Arellana", ciudad: "Bogotá, D.C." },
  "1193544721": { nombre: "Luisa Fernanda Rios Colorado", ciudad: "Medellín" },
  "25285795": { nombre: "Deyanira Gomez", ciudad: "Popayán" },
  "1003115766": { nombre: "Onairis Garcia Carrillo", ciudad: "Bogotá, D.C." },
  "1000410544": { nombre: "Laura Gallo", ciudad: "MEDELLIN" },
  "1020789420": { nombre: "MARIA CAMILA  CASTRO CHAPARRO", ciudad: "RIONEGRO" },
  "1025887164": { nombre: "Maria Fernanda Garcia Perez", ciudad: "Vegachí" },
  "1035861284": { nombre: "Esteban Mauricio Amaya Restrepo", ciudad: "Copacabana" },
  "1036393280": { nombre: "Luz Dary Giraldo Zuluaga", ciudad: "El Carmen de Viboral" },
  "1037620882": { nombre: "DANIEL GIL", ciudad: "QUIMBAYA" },
  "1040035615": { nombre: "Greisy Johanna Betancur Castro", ciudad: "La Ceja" },
  "1040038983": { nombre: "Natalia Bedoya Osorio", ciudad: "El Retiro" },
  "1128422873": { nombre: "ALEJANDRO MORALES ARTEAGA", ciudad: "Rionegro" },
  "1143844513": { nombre: "CINDY JIMENEZ", ciudad: "Cali" },
  "1143394473": { nombre: "Aury Caicedo Ruiz", ciudad: "San Andrés" },
  "1118125614": { nombre: "Carolina Calixto", ciudad: "Monterrey" },
  "1117542697": { nombre: "Mary Vargas", ciudad: "Florencia" },
  "1097782332": { nombre: "Zirley Acevedo", ciudad: "Floridablanca" },
  "1098791041": { nombre: "DANIELA ROJAS", ciudad: "Bucaramanga" },
  "1098807532": { nombre: "Dayana Cristancho", ciudad: "Floridablanca" },
  "1091677885": { nombre: "Yvett Valeria Cuevas Ortiz", ciudad: "Ocaña" },
  "1087800449": { nombre: "AILYN PATIÑO", ciudad: "PUMACO" },
  "1042770601": { nombre: "El Palacio De Los Cosmeticos Mz", ciudad: "La Ceja" },
  "1047452753": { nombre: "Carmen Maria Coneo Ibanez", ciudad: "Montería" },
  "1059785676": { nombre: "Lina Hoyos", ciudad: "Risaralda" },
  "1053856293": { nombre: "Santiago Martinez", ciudad: "Manizales" },
  "1065898466": { nombre: "Katerin Lorena Hernandez Jimenez", ciudad: "Bosconia" },
  "1082977539": { nombre: "Eva Hernandez", ciudad: "Santa Marta" },
  "1088323396": { nombre: "Diana Marcela Correa Arango", ciudad: "Pereira" },
  "1087553676": { nombre: "Maryely Restrepo Zapata", ciudad: "La Virginia" },
  "1100971100": { nombre: "Natalia Porras", ciudad: "San Gil" },
  "1097100854": { nombre: "Sofia Gamboa", ciudad: "Medellín" },
  "1151958202": { nombre: "Eddie Martin", ciudad: "Arauca" },
  "113290815": { nombre: "Eylin Hernandez Cubillo", ciudad: "Bogotá, D.C." },
  "1038126183": { nombre: "Maria Cristina Restrepo Luna", ciudad: "Caucasia" },
  "1031420349": { nombre: "Sara Jimena Gil Alvarez", ciudad: "Bello" },
  "1030651978": { nombre: "Brigette Xiomara Alfonso Garcia", ciudad: "Bogotá, D.C." },
  "1026160088": { nombre: "Alejandra Martínez Vera", ciudad: "Caldas" },
  "1024478414": { nombre: "Yenni Alexis Mora", ciudad: "Bogotá, D.C." },
  "900816838-2": { nombre: "LINEA ESTETICA", ciudad: "MEDELLIN" },
  "1002344188": { nombre: "Maria Fernanda Bobadilla Cuesta", ciudad: "Cartagena de Indias" },
  "1005039986": { nombre: "Yuliana Andrea Bermudez Rodriguez", ciudad: "Los Patios" },
  "1007694759": { nombre: "Angie Paola Arevalo Orjuela", ciudad: "Chía" },
  "193520493": { nombre: "Alexandra Garcia Marin", ciudad: "Cali" },
  "1221718434": { nombre: "Pamela Vanessa Valencia Ramirez", ciudad: "Bogotá, D.C." },
  "1225091127": { nombre: "Yuri Alejandra Restrepo", ciudad: "Valle del Guamuez" },
  "4866614": { nombre: "Yanibel Perez", ciudad: "Bogotá, D.C." },
  "44005448": { nombre: "Leidy Marcela Gonzalez Gomez", ciudad: "Medellín" },
  "43748138": { nombre: "Lady Janeth Pareja Londono", ciudad: "Medellín" },
  "901843612": { nombre: "Makeupjuliastore Sas", ciudad: "Bogotá, D.C." },
  "8755549": { nombre: "Jorge Gonzalez", ciudad: "Barranquilla" },
  "901254602": { nombre: "Variedades sys SAS", ciudad: "Bogotá, D.C." },
  "9010877862": { nombre: "SELLO GLOBAL S.A.S", ciudad: "MEDELLIN" },
  "901797602": { nombre: "Paraiso Capilar Y Corporal", ciudad: "Bogotá, D.C." },
  "901533638": { nombre: "German Dario Aristizabal", ciudad: "Medellín" },
  "890923922-6": { nombre: "SEMCO S.A.", ciudad: "Medellín" },
  "716614988": { nombre: "Hernan de Jesus Aristizabal Gómez", ciudad: "Medellín" },
  "1192899716": { nombre: "Sofia Zuniga Gomez", ciudad: "Armenia" },
  "1403057": { nombre: "Maria Alejandra Varela Marquez", ciudad: "Bogotá, D.C." },
  "23547186": { nombre: "Jennifer Sirit", ciudad: "VILLA DEL ROSARIO" },
  "26883435": { nombre: "Yulis Camacho", ciudad: "Fundación" },
  "30413080": { nombre: "Maryangel Morales", ciudad: "Medellín" },
  "1007349615": { nombre: "Derly Lopez", ciudad: "Pitalito" },
  "1017236307": { nombre: "Andrea Gonzalez", ciudad: "Medellín" },
  "1017137142": { nombre: "Paula Andrea Otalvaro", ciudad: "Medellín" },
  "1016030276": { nombre: "Alejandra Ortiz", ciudad: "Fusagasugá" },
  "1004826566": { nombre: "Catalina Pena", ciudad: "Armenia" },
  "1000204695": { nombre: "Yenifer Acosta", ciudad: "Medellín" },
  "1000404597": { nombre: "María José Carvajal Rios", ciudad: "Bello" },
  "1000789301": { nombre: "Paula Andrea Diaz Vargas", ciudad: "Acacías" },
  "1036941349": { nombre: "Ricardo Baena Gómez", ciudad: "Rionegro" },
  "1036782871": { nombre: "Shirley Patricia Diaz Orozco", ciudad: "Medellín" },
  "1036639974": { nombre: "Jessica Suarez Martinez", ciudad: "Itagüí" },
  "1041148355": { nombre: "Veronica Muniz Valencia", ciudad: "Marinilla" },
  "1039467736": { nombre: "Luisa María palacio Jaramillo", ciudad: "Sabaneta" },
  "1117526453": { nombre: "Lorena Hernandez Ortiz", ciudad: "Florencia" },
  "1116913569": { nombre: "Elizabeth Rincon", ciudad: "Bogotá, D.C." },
  "1110522541": { nombre: "LUISA MILENA GARCIA RODRIGUEZ", ciudad: "Ibagué" },
  "1101049546": { nombre: "EIMAR SAAVEDRA", ciudad: "Valle de San José" },
  "1092455607": { nombre: "Maria Jose Cardona Marulanda", ciudad: "Quimbaya" },
  "1082837815": { nombre: "lina yesenia carreño rangel", ciudad: "Santa Marta" },
  "1087548620": { nombre: "Manuela Garcia Acevedo", ciudad: "La Virginia" },
  "1067949524": { nombre: "Natalia andrea Carrascal alvarez", ciudad: "Montería" },
  "1054549485": { nombre: "Leidy María López Barrera", ciudad: "Armenia" },
  "1053822036": { nombre: "DANIEL FERNANDO LOPEZ UMAÑANA", ciudad: "Medellín" },
  "1045022732": { nombre: "Eduan Yezid Gómez Serna", ciudad: "El Santuario" },
  "1047973270": { nombre: "ISABEL HINCAPIE", ciudad: "Sonsón" },
  "1049029304": { nombre: "Adriana Carolina Vesga Medina", ciudad: "Santa Rosa del Sur" },
  "1053866875": { nombre: "Natalia Salazar Cardona Salazar Cardona", ciudad: "Villamaría" },
  "1088269850": { nombre: "JONHATAN GUTIERREZ", ciudad: "Pereira" },
  "1096252093": { nombre: "Elizabeth Guerrero", ciudad: "Barrancabermeja" },
  "1109298847": { nombre: "Rocio Quimbayo", ciudad: "Fresno" },
  "1111665958": { nombre: "Luis Miguel Olave Canon", ciudad: "Santiago de Cali" },
  "1117499880": { nombre: "Malhory Stefani Rivera Morales", ciudad: "Florencia" },
  "1128051333": { nombre: "PAOLA ANDREA GIRALDO ARANGO", ciudad: "Cartagena de Indias" },
  "1124829751": { nombre: "Paula Andrea Burbano", ciudad: "San José del Guaviare" },
  "1126447636": { nombre: "Joana Caterine Martinez", ciudad: "Acevedo" },
  "1038544047": { nombre: "Yeidy Yomaira Hernández Parra", ciudad: "Remedios" },
  "1040036580": { nombre: "Sandra Arbelaez Gaviria", ciudad: "La Ceja" },
  "1036632221": { nombre: "Liz Buitrago", ciudad: "Envigado" },
  "1036966036": { nombre: "Vanessa Taborda", ciudad: "Rionegro" },
  "1037501813": { nombre: "Milena Londono", ciudad: "Itagüí" },
  "1037667753": { nombre: "KARINA ARROYAVE", ciudad: "Envigado" },
  "1022372827": { nombre: "KATHERIN GIRALGO", ciudad: "Bogotá, D.C." },
  "1020441956": { nombre: "Julián David Penagos Pérez", ciudad: "El Carmen de Viboral" },
  "1027887072": { nombre: "Paula Botero Gomez", ciudad: "Andes" },
  "1032421477": { nombre: "Paula Andrea Cuervo Arias", ciudad: "Bogotá, D.C." },
  "1035857471": { nombre: "Carolina Correa", ciudad: "Girardota" },
  "1000921833": { nombre: "Mariana Gomez Sanchez", ciudad: "Caldas" },
  "1000603792": { nombre: "Just Aristizabal", ciudad: "Bogotá, D.C." },
  "1002064659": { nombre: "Dionisio Alejandro Murillo", ciudad: "Guarne" },
  "1017185311": { nombre: "YESENIA GARCIA", ciudad: "Medellín" },
  "1017922580": { nombre: "Isabella Osorio", ciudad: "Envigado" },
  "1007121123": { nombre: "LUISA FERNANDA SANCHEZ", ciudad: "COPACABANA" },
  "1010174541": { nombre: "Erika Hernández", ciudad: "Bogotá, D.C." },
  "30339009": { nombre: "ANGELA MARIA OTALVARO DUQUE", ciudad: "Manizales" },
  "2716060": { nombre: "Miguel Angel Beltrán", ciudad: "Armenia" },
  "118203225": { nombre: "Karen Tovar", ciudad: "Villavicencio" },
  "11909": { nombre: "Dalia Collado", ciudad: "Bogotá, D.C." },
  "1152219566": { nombre: "NATALIA RAMIREZ", ciudad: "Cartago" },
  "1152222170": { nombre: "SUSANA GRACIANO", ciudad: "MEDELLIN" },
  "43187042": { nombre: "Paula Andrea Perez", ciudad: "Itagüí" },
  "42154312": { nombre: "Juliana Lopez", ciudad: "Pereira" },
  "87219723": { nombre: "VICTOR ESTRADA", ciudad: "IPIALES" },
  "830129327-1": { nombre: "FARMATODO COLOMBIA S A", ciudad: "MEDELLIN" },
  "901411591": { nombre: "Ag Cosmetic Sas", ciudad: "Medellín" },
  "901713554": { nombre: "Elizabeth Romero Rodriguez", ciudad: "Bogotá, D.C." },
  "901692135": { nombre: "TRINITY COMPAÑIA S.A.S.", ciudad: "Medellín" },
  "901811850": { nombre: "VITRO INC SAS", ciudad: "Bucaramanga" },
  "901811940": { nombre: "BEAUTY HILLS SAS", ciudad: "Medellín" },
  "901954094": { nombre: "COCO PINK S.A.S", ciudad: "Medellín" },
  "901978501": { nombre: "Geovanna Beauty S.A.S", ciudad: "Palmira" },
  "901906620": { nombre: "Valentina Arandana Bueno", ciudad: "Bucaramanga" },
  "901885213": { nombre: "BOREAL GROUP M.L. SAS", ciudad: "Bucaramanga" },
  "901952195": { nombre: "DISTRIBUIDORA CIGA COL SAS", ciudad: "Santiago de Cali" },
  "901939095": { nombre: "Maria Fernanda Pena", ciudad: "Sabaneta" },
  "901758503": { nombre: "S.A.S ADA ROSA", ciudad: "Bogotá, D.C." },
  "901802318": { nombre: "Primor Colombia SAS", ciudad: "Medellín" },
  "901805358": { nombre: "TIENDAS VR MULTIMARCAS SAS", ciudad: "Medellín" },
  "901427659": { nombre: "MELONN S.A.S.", ciudad: "MEDELLIN" },
  "901361936-5": { nombre: "LUEGO PAGO", ciudad: "MEDELLIN" },
  "901560345": { nombre: "FUJI IMPORTS SAS", ciudad: "Medellín" },
  "63453575": { nombre: "Carolina Pico Figueredo", ciudad: "Chía" },
  "80432408": { nombre: "Walter Álvarez Mora", ciudad: "Chía" },
  "811017000-7": { nombre: "LINEA DIRECTA S.A.S.", ciudad: "LA ESTRELLA" },
  "900365205-4": { nombre: "PROSALON DISTRIBUCIONES SAS", ciudad: "BOGOTA" },
  "42135539": { nombre: "Johana Agudelo", ciudad: "Pereira" },
  "40218675": { nombre: "Liliana Estupinan Henao", ciudad: "Bello" },
  "36068857": { nombre: "Marilu Fierro", ciudad: "Neiva" },
  "60437065": { nombre: "Sandra Yanet Rolon Manrique", ciudad: "Tibú" },
  "5144814": { nombre: "Zuleima Ramirez", ciudad: "Facatativá" },
  "1193101331": { nombre: "LINA MARIA LINA MARIA CAMPUZANO MOREANO", ciudad: "Santiago de Cali" },
  "1234645799": { nombre: "Laura Camila Cortes peña", ciudad: "Ibagué" },
  "1006823200": { nombre: "Lizeth Daniela Baquero Jara", ciudad: "Villavicencio" },
  "1007914406": { nombre: "Maria Alejandra Ramirez", ciudad: "Cali" },
  "1006995694": { nombre: "Jiraldy Alvarez", ciudad: "San Miguel" },
  "1000474284": { nombre: "Danna Gaona Osorio", ciudad: "Santiago de Cali" },
  "1112465496": { nombre: "Leidy Jhoana Rios", ciudad: "Jamundí" },
  "1115078307": { nombre: "Carolina Loaiza Zuleta", ciudad: "Guadalajara de Buga" },
  "1128277149": { nombre: "ANDRES GABRIEL SALAZAR", ciudad: "Medellín" },
  "1124040238": { nombre: "Angie Ledesma", ciudad: "Agustín Codazzi" },
  "80432408": { nombre: "Walter Álvarez Mora", ciudad: "Chía" },
  "811017000-7": { nombre: "LINEA DIRECTA S.A.S.", ciudad: "LA ESTRELLA" },
  "901361936-5": { nombre: "LUEGO PAGO", ciudad: "MEDELLIN" },
  "42135539": { nombre: "Johana Agudelo", ciudad: "Pereira" },
  "40218675": { nombre: "Liliana Estupinan Henao", ciudad: "Bello" },
  "5144814": { nombre: "Zuleima Ramirez", ciudad: "Facatativá" },
  "63453575": { nombre: "Carolina Pico Figueredo", ciudad: "Chía" },
  "60437065": { nombre: "Sandra Yanet Rolon Manrique", ciudad: "Tibú" },
  "1234645799": { nombre: "Laura Camila Cortes peña", ciudad: "Ibagué" },
  "1193101331": { nombre: "LINA MARIA LINA MARIA CAMPUZANO MOREANO", ciudad: "Santiago de Cali" },
  "1141315220": { nombre: "Marcela Valero", ciudad: "Uribe" },
  "1143148554": { nombre: "ROGER MARQUEZ", ciudad: "MEDELLIN" },
  "36068857": { nombre: "Marilu Fierro", ciudad: "Neiva" },
  "7568285": { nombre: "HERNANDO OCAMPO", ciudad: "Armenia" },
  "901677049": { nombre: "GRUPO FUSCIA SAS", ciudad: "Pereira" },
  "901865356": { nombre: "TIENDAS MARTINA SAS", ciudad: "Medellín" },
  "1128451385": { nombre: "Maribel Cristina Garcia Restrepo", ciudad: "Medellín" },
  "1113303497": { nombre: "Yamileth Andrea Zuluaga Rozo", ciudad: "Mocoa" },
  "1024578797": { nombre: "Maria Fernanda Garcia Suarez", ciudad: "Bogotá, D.C." },
  "1007757959": { nombre: "Yohana Bedoya", ciudad: "Bogotá, D.C." },
  "1006326781": { nombre: "Jisel Melisa Villareal", ciudad: "Palmira" },
  "1036782871": { nombre: "Shirley Patricia Diaz Orozco", ciudad: "Medellín" },
  "1036403976": { nombre: "Manuela Gil Rodriguez", ciudad: "El Carmen de Viboral" },
  "901802318": { nombre: "Primor Colombia SAS", ciudad: "Medellín" },
  "1081273263": { nombre: "Anna Katherine Davila Arteaga", ciudad: "Pasto" },
  "1040323660": { nombre: "Erika Cruz Ospina", ciudad: "San Pedro de los Milagros" },
  "1017206200": { nombre: "Paula Andrea Quintero Soto", ciudad: "Medellín" },
  "116850872": { nombre: "Sofia Nunez Araya", ciudad: "Bogotá, D.C." },
  "1113623994": { nombre: "Yuleidy Tabares Pereira", ciudad: "Santiago de Cali" },
  "1070967246": { nombre: "Vanessa Nieto Alcosser", ciudad: "Facatativá" },
  "1047499672": { nombre: "Angie paola ceballo martinez", ciudad: "Cartagena de Indias" },
  "1037946502": { nombre: "Karen Lorena Florez Daza", ciudad: "Medellín" },
  "1093918473": { nombre: "Yaritza Andrea Luna santos", ciudad: "San José de Cúcuta" },
  "900422967": { nombre: "Belleza Y Color Distribuciones Sas", ciudad: "Pereira" },
  "1036941349": { nombre: "Ricardo Baena Gómez", ciudad: "Rionegro" },
  "1144082304": { nombre: "PATRICIA NARVAEZ", ciudad: "Santiago de Cali" },
  "1040035226": { nombre: "Valeria Rios Carmona", ciudad: "La Ceja" },
  "1004519859": { nombre: "Angie Marin", ciudad: "Dosquebradas" },
  "1193396335": { nombre: "Gabriela Lemus", ciudad: "Ibagué" },
  "1077970748": { nombre: "Brenda Natalia Suarez Ramirez", ciudad: "Villeta" },
  "1054560100": { nombre: "BILMA SOLANYI OSPINA JIMENEZ", ciudad: "La Dorada" },
  "1114453066": { nombre: "Monica Alexandra Monroy", ciudad: "Guacarí" },
  "1040050825": { nombre: "Daniela Alzate Trujillo", ciudad: "La Ceja" },
  "1127948924": { nombre: "Maria Camila Cifuentes Marulanda", ciudad: "Bogotá, D.C." },
  "91183559": { nombre: "Gonzalo Parra", ciudad: "Cúcuta" },
  "1038136678": { nombre: "Maria Camila Tenorio Caly", ciudad: "Caucasia" },
  "6428458": { nombre: "Clemery Soto", ciudad: "Rionegro" },
  "1128441520": { nombre: "Sara Ximena Arango Sepulveda", ciudad: "Medellín" },
  "1098712909": { nombre: "Lizeth Paola Sierra Parra", ciudad: "Girón" },
  "1020817096": { nombre: "ALEJANDRA PULIDO CRUZ", ciudad: "Bogotá, D.C." },
  "15441517": { nombre: "Leonardo Alberto Martinez Guarin", ciudad: "Rionegro" },
  "901289100": { nombre: "Inversiones 111 Tiendas De Belleza Sas", ciudad: "Medellín" },
  "1093775788": { nombre: "Mayra Luna Pretelt", ciudad: "Medellín" },
  "1007240153": { nombre: "Ana Yulieth", ciudad: "Carolina del Príncipe" },
  "60412396": { nombre: "Jheny Tibisay Mora", ciudad: "Villa del Rosario" },
  "27542504": { nombre: "Elisa Mainguez", ciudad: "Santiago de Cali" },
  "1096247965": { nombre: "Vanessa De La Rosa", ciudad: "Barrancabermeja" },
  "1073516353": { nombre: "Rocio Larrota Neisa", ciudad: "Mosquera" },
  "1098752947": { nombre: "Karen Castro Castro", ciudad: "Ocaña" },
  "1036961151": { nombre: "Mariana Ariza Murillo", ciudad: "Rionegro" },
  "1095939714": { nombre: "Andrea Paola Penaranda Pinzon", ciudad: "Girón" },
  "52102673": { nombre: "Carmen Hernandez", ciudad: "Bogotá, D.C." },
  "1038126183": { nombre: "Maria Cristina Restrepo Luna", ciudad: "Caucasia" },
  "1088269850": { nombre: "JONHATAN GUTIERREZ", ciudad: "Pereira" },
  "79607403": { nombre: "Duberney Ramirez", ciudad: "Bogotá, D.C." },
  "1003579077": { nombre: "Laura Valentina Hernandez Guaqueta", ciudad: "La Calera" },
  "1087548620": { nombre: "Manuela Garcia Acevedo", ciudad: "La Virginia" },
  "1002655088": { nombre: "Sofia Salazar Alzate", ciudad: "Medellín" },
  "1017150913": { nombre: "DIANA CAROLINA MONTOYA", ciudad: "Montería" },
  "1010133841": { nombre: "Brenda Catalina Miranda Enriquez", ciudad: "Pasto" },
  "1152688792": { nombre: "Suad Elena Franco Mercado", ciudad: "Caucasia" },
  "17545214": { nombre: "Lisbetny Colina", ciudad: "Maicao" },
  "1130639696": { nombre: "Claudia Molina Valencia", ciudad: "Santiago de Cali" },
  "1007135547": { nombre: "Juliana Rodriguez", ciudad: "Bogotá, D.C." },
  "1127660744": { nombre: "Marlin Gomez", ciudad: "Medellín" },
  "37086398": { nombre: "Jackeline Hincapie", ciudad: "Pasto" },
  "1000536363": { nombre: "Valentina Perez Valencia", ciudad: "Medellín" },
  "1007352139": { nombre: "Yarledy Gomez Betancur", ciudad: "Marinilla" },
  "1126458543": { nombre: "Katherynn Cerón Arteaga", ciudad: "Valle del Guamuez" },
  "41912017": { nombre: "Olga Lucia Arias Gil", ciudad: "Armenia" },
  "1114338998": { nombre: "Jhoana Milena Rendon Mesa", ciudad: "Restrepo" },
  "1017231358": { nombre: "Mayerli García Marín", ciudad: "Medellín" },
  "1040734872": { nombre: "Jenifer Yulie Zapata", ciudad: "La Estrella" },
  "52986680": { nombre: "Magda Zambrano Castillo", ciudad: "Bogotá, D.C." },
  "1128281597": { nombre: "Cindy Juliana Hernandez Roldan", ciudad: "Medellín" },
  "1007554838": { nombre: "Evelin Gonzalez", ciudad: "Bucaramanga" },
  "1019043190": { nombre: "Lucia Canaveral Tena", ciudad: "Bogotá, D.C." },
  "1088030786": { nombre: "Karen Agudelo", ciudad: "Pereira" },
  "80175355": { nombre: "Claudia Murcia", ciudad: "Bogotá, D.C." },
  "1069758300": { nombre: "Paula Andrea Betancourt Diaz", ciudad: "Fusagasugá" },
  "1036966139": { nombre: "Maritza Lotero Rios", ciudad: "Marinilla" },
  "901673475": { nombre: "Inversiones Soy,S S.A.S.", ciudad: "Malambo" },
  "1124859298": { nombre: "Jessica Lorena Gomez", ciudad: "Mocoa" },
  "1036781349": { nombre: "Alejandra Valencia Pineda", ciudad: "La Ceja" },
  "1045018253": { nombre: "Yuli Andrea Ramirez", ciudad: "Pereira" },
  "1111800709": { nombre: "Maria Ocampo Salazar", ciudad: "Santiago de Tolú" },
  "1077467461": { nombre: "Yesica Paola Cano Correa", ciudad: "POLICARPA" },
  "1053770466": { nombre: "Lorena Gonzalez Lopez", ciudad: "Riosucio" },
  "1082922435": { nombre: "Jeraldin Ospino", ciudad: "Santa Marta" },
  "37885114": { nombre: "Martha Parra Sarmiento", ciudad: "San Gil" },
  "1085334330": { nombre: "Victoria Yanez Cordoba", ciudad: "Pasto" },
  "1090459470": { nombre: "Arnold Marquez", ciudad: "Aguachica" },
  "1121955432": { nombre: "Neidy Alvarado", ciudad: "Villavicencio" },
  "1126455524": { nombre: "Mishel Aristizabal", ciudad: "Valle del Guamuez" },
  "1005852978": { nombre: "Daniela Alejandra Quintero Munoz", ciudad: "El Doncello" },
  "1088259402": { nombre: "Libby Vargas", ciudad: "Pereira" },
  "1110577849": { nombre: "Dahyana Gomez Lopez", ciudad: "Puerto Asís" },
  "1020751497": { nombre: "DIANA MARCELA AMAYA", ciudad: "Zipaquirá" },
  "1096224569": { nombre: "Yessica Luyini Parejo Sanguinetty", ciudad: "Bogotá, D.C." },
  "1116551930": { nombre: "Lineth Zulay Figueredo", ciudad: "Aguazul" },
  "1094895535": { nombre: "Diego Alejandro Zuluaga", ciudad: "Armenia" },
  "1121909442": { nombre: "Xiomara Ospina", ciudad: "Villavicencio" },
  "900167764": { nombre: "Surticosmeticos", ciudad: "Santiago de Cali" },
  "1019154139": { nombre: "Valeria Usuga Rubiano", ciudad: "Villanueva" },
  "1010139640": { nombre: "Laura Cabrera", ciudad: "Bogotá, D.C." },
  "1037642220": { nombre: "Daniela Ruiz Arroyave", ciudad: "Sabaneta" },
  "1036951011": { nombre: "Laura Cristina Munoz Montoya", ciudad: "Rionegro" },
  "1116871126": { nombre: "Jessica Vanessa Riano Rodriguez", ciudad: "Tame" },
  "1112790308": { nombre: "Nathalia Panesso Aponte", ciudad: "Cartago" },
  "1089385395": { nombre: "Angelica Lopez Serna", ciudad: "Bogotá, D.C." },
  "1004681514": { nombre: "Juliana Correa", ciudad: "Cartago" },
  "1087488399": { nombre: "Luisa Fernanda Vargas Santamaria", ciudad: "BELÉN DE UMBRÍA" },
  "1058198197": { nombre: "Sharon Cometa", ciudad: "La Dorada" },
  "1140882389": { nombre: "Shanny Machado", ciudad: "Barranquilla" },
  "1061779023": { nombre: "Samara Toro Arias", ciudad: "Valle del Guamuez" },
  "1089747865": { nombre: "Daniela Gonzalez Duque", ciudad: "Marsella" },
  "1122137855": { nombre: "Jeimy Xiomara Carrillo Pinzon", ciudad: "Acacías" },
  "42844263": { nombre: "Nancy Milena Giraldo Carvajal", ciudad: "Marinilla" },
  "1115083785": { nombre: "Laura Cecilia Betancourt", ciudad: "Guadalajara de Buga" },
  "901466326": { nombre: "Mundial Shop S.A.S.", ciudad: "Medellín" },
  "901489284": { nombre: "Alejandro Bustamante", ciudad: "Medellín" },
  "1144137824": { nombre: "Yesenia Jimenez Castano", ciudad: "Santiago de Cali" },
  "1121857383": { nombre: "Eliana Quintero Buitrago", ciudad: "Restrepo" },
  "1193510458": { nombre: "Daniela Baez Molina", ciudad: "Bucaramanga" },
  "1005182079": { nombre: "DANIELA BARBOSA", ciudad: "Barrancabermeja" },
  "52185610": { nombre: "Cristina Suarez", ciudad: "Bogotá, D.C." },
  "1003894832": { nombre: "Maira Alejandra Bustos Medina", ciudad: "Neiva" },
  "1088736152": { nombre: "Maria Camila Rodriguez", ciudad: "Cali" },
  "1110504885": { nombre: "Martha Tellez Romero", ciudad: "Ibagué" },
  "1049618585": { nombre: "Leidy Garcia", ciudad: "Tunja" },
  "63453912": { nombre: "Yadiris Galvis", ciudad: "Curumaní" },
  "39192319": { nombre: "Maide Yalime Guarin Blandon", ciudad: "Rionegro" },
  "901341467": { nombre: "Luisa Quintana", ciudad: "San José del Guaviare" },
  "36275743": { nombre: "Lady Andrea Guio Escobar", ciudad: "La Plata" },
  "39456142": { nombre: "Claudia Leon", ciudad: "Envigado" },
  "46649305": { nombre: "Leidy Carolina Henao Perez", ciudad: "Otanche" },
  "52825281": { nombre: "BOREAL GROUP M.L. SAS", ciudad: "Bogotá, D.C." },
  "53160574": { nombre: "Jennifer Garcés Cárdenas", ciudad: "Bogotá, D.C." },
  "109872979": { nombre: "Miller Alexander Mendieta Burbano", ciudad: "Bucaramanga" },
  "900464794": { nombre: "Wendy Alexandra Nino Guerrero", ciudad: "Medellín" },
  "901705567": { nombre: "Frankin Eduardo López Florez", ciudad: "Tunja" },
  "901885213": { nombre: "Laura Cristina Munoz Montoya", ciudad: "Bucaramanga" },
  "1007562307": { nombre: "Olga Lucia Cedeno", ciudad: "Arboletes" },
  "1022372827": { nombre: "Mafer Urrego", ciudad: "Bogotá, D.C." },
  "1026263752": { nombre: "INVERSIONES KAUTIVA S.A.S", ciudad: "Mapiripán" },
  "1036951011": { nombre: "Maria Cadavid", ciudad: "Rionegro" },
  "1041327551": { nombre: "Diana soler Soler", ciudad: "Medellín" },
  "1070781670": { nombre: "Valentina Leiva", ciudad: "Villeta" },
  "1096224569": { nombre: "Yessica Luyini Parejo Sanguinetty", ciudad: "Bogotá, D.C." },
  "1098750489": { nombre: "Angie Daniela Valencia Buitrago", ciudad: "Aguazul" },
  "1108928096": { nombre: "Mary Ardila", ciudad: "Guamo" },
  "1113311489": { nombre: "Yudy Andrea Machado Rocha", ciudad: "Sevilla" },
  "1113592444": { nombre: "MARTINA GALVIS FLOREZ", ciudad: "Guadalajara de Buga" },
  "1116913569": { nombre: "Gabriela Medellin", ciudad: "Bogotá, D.C." },
  "1143469308": { nombre: "Elizabeth Rincon", ciudad: "Barranquilla" },
  "1152186084": { nombre: "Sandra Yameli Botero Ramírez", ciudad: "Medellín" },
  "1193125601": { nombre: "KATHERIN GIRALGO", ciudad: "Bogotá, D.C." },
  "1020303372": { nombre: "Sara Cruz Ruiz", ciudad: "MEDELLÍN" },
  "1005179315": { nombre: "Dayana Celis", ciudad: "MEDELLÍN" },
  "1037615568": { nombre: "MARYCELA RODRIGUEZ", ciudad: "MEDELLÍN" },
  "1128434220": { nombre: "Kelly Otalvaro Tamayo", ciudad: "MEDELLÍN" },
  "1017246514": { nombre: "Estefania Agudelo", ciudad: "MEDELLÍN" },
  "1017241347": { nombre: "Maria Marin", ciudad: "MEDELLÍN" },
  "1148205809": { nombre: "Manuela Villada López", ciudad: "MEDELLÍN" },
  "1214738110": { nombre: "Mariana Olaya", ciudad: "MEDELLÍN" },
  "1234989597": { nombre: "Carolina Tabares Pulgarin", ciudad: "MEDELLÍN" },
  "43871000": { nombre: "Angela Maria Sanchez", ciudad: "MEDELLÍN" },
  "1152701974": { nombre: "Arelis Avendaño", ciudad: "MEDELLÍN" },
  "1017168395": { nombre: "Sandra Montoya", ciudad: "MEDELLÍN" },
  "1214718894": { nombre: "Luisa Castro", ciudad: "MEDELLÍN" },
  "1214744141": { nombre: "Valentina Villa Martínez", ciudad: "MEDELLÍN" },
  "1040870913": { nombre: "Juanita Aristizábal", ciudad: "MEDELLÍN" },
  "1017144062": { nombre: "Leidy Giraldo", ciudad: "MEDELLÍN" },
  "1152226589": { nombre: "Valentina Pinilla Crespo", ciudad: "MEDELLÍN" },
  "1036400873": { nombre: "Isabel Cristina", ciudad: "MEDELLÍN" },
  "1152700449": { nombre: "laura alejandra botero barrientos", ciudad: "MEDELLÍN" },
  "1214732290": { nombre: "Laura Garzón Puerta", ciudad: "MEDELLÍN" },
  "1001003939": { nombre: "Tatiana Gil Ocampo", ciudad: "MEDELLÍN" },
  "1128414384": { nombre: "Monica Valle", ciudad: "MEDELLÍN" },
  "1025887561": { nombre: "Dani Cadavid", ciudad: "MEDELLÍN" },
  "43837744": { nombre: "Sandra García", ciudad: "MEDELLÍN" },
  "1036957547": { nombre: "Luisa maria Soto", ciudad: "MEDELLÍN" },
  "1036250124": { nombre: "Ana María Jiménez Betancourt", ciudad: "MEDELLÍN" },
  "42940283": { nombre: "Adelaida Rodriguez", ciudad: "MEDELLÍN" },
  "1035856093": { nombre: "Paola Estrada", ciudad: "MEDELLÍN" },
  "1002129679": { nombre: "Valentina Cano", ciudad: "MEDELLÍN" },
  "1152702944": { nombre: "Melissa Morales", ciudad: "MEDELLÍN" },
  "1193542531": { nombre: "Valentina Cujar", ciudad: "MEDELLÍN" },
  "1193546084": { nombre: "WENDY BATISTA", ciudad: "MEDELLÍN" },
  "1017202139": { nombre: "Laura Carolina Ramírez Quijano", ciudad: "MEDELLÍN" },
  "1152190301": { nombre: "Paloma Sánchez Vélez", ciudad: "MEDELLÍN" },
  "1001376388": { nombre: "Laura Vélez", ciudad: "MEDELLÍN" },
  "1037666118": { nombre: "Laura Gómez Castañeda", ciudad: "MEDELLÍN" },
  "1146439494": { nombre: "Johana Suárez", ciudad: "MEDELLÍN" },
  "2222222222": { nombre: "Sofía Sepúlveda Correa", ciudad: "MEDELLÍN" },
  "1098633219": { nombre: "Nathalia Rivero Rodriguez", ciudad: "MEDELLÍN" },
  "116850872": { nombre: "Sofia Nunez Araya", ciudad: "Bogotá, D.C." },
  "1062321196": { nombre: "Lina Marcela Pereira Orozco", ciudad: "Cauca" },
  "39190267": { nombre: "Sonia Yaneth Bedoya", ciudad: "Antioquia" },
  "901596460": { nombre: "Jenniffer Giraldo", ciudad: "Valle del Cauca" },
  "1007159340": { nombre: "Paula Contreras Hernandez", ciudad: "Cundinamarca" },
  "1098626844": { nombre: "Jennifer Barbosa Lizarazo", ciudad: "Santander" },
  "1053824733": { nombre: "Angela Bibiana Rios Villa", ciudad: "Caldas" },
  "1107070188": { nombre: "Diana Karina Villegas Macuase", ciudad: "Valle del Cauca" },
  "1038338883": { nombre: "VALERIA RAMÍREZ PULGARIN", ciudad: "Antioquia" },
  "901906620": { nombre: "Valentina Arandana Bueno", ciudad: "Santander" },
  "1045025289": { nombre: "Edison Santiago Giraldo Zuluaga", ciudad: "Santander" },
  "1013098223": { nombre: "Maria Alejandra Garzon", ciudad: "Bogotá, D.C." },
  "1019050384": { nombre: "Paola Andrea Gonzalez Marin", ciudad: "Bogotá, D.C." },
  "901956910": { nombre: "Bella y Vanidosas Sas", ciudad: "Antioquia" },
  "1045017318": { nombre: "Liana Marcela Aristizabal", ciudad: "Cauca" },
  "1083814235": { nombre: "Karen Sofia Luna Gomez", ciudad: "Nariño" },
  "1114402301": { nombre: "Paulina Ramirez", ciudad: "Risaralda" },
  "1007757377": { nombre: "Yeisi Restrepo", ciudad: "Cundinamarca" },
  "43926816": { nombre: "Natalia Milena Montoya Restrepo", ciudad: "Antioquia" },
  "1053795386": { nombre: "Jhony Alexander Ospina Giraldo", ciudad: "Manizales" },
  "1007291329": { nombre: "Manuela Montoya", ciudad: "Rionegro" },
  "1098631443": { nombre: "Silvia Juliana Poveda Herrera", ciudad: "Bucaramanga" },
  "53090579": { nombre: "Lina Amezquita", ciudad: "Bogotá, D.C." },
  "63555958": { nombre: "Jenifer Cruz", ciudad: "Bucaramanga" },
  "1059785676": { nombre: "Lina Hoyos", ciudad: "Risaralda" },
  "70756826": { nombre: "Henry Mauricio Cano Ruiz", ciudad: "Guarne" },
  "1047973040": { nombre: "Maria Cristina Castano Hurtado", ciudad: "Sonsón" },
  "1032461124": { nombre: "Andres Felipe Orozco", ciudad: "Bogotá, D.C." },
  "1083894682": { nombre: "Laura Valentina Rodriguez Urbano", ciudad: "Pitalito" },
  "901843612": { nombre: "Makeupjuliastore Sas", ciudad: "Bogotá, D.C." },
  "1095823476": { nombre: "Laura Marcela Barrero Rueda", ciudad: "Bucaramanga" },
  "1232406689": { nombre: "Kleivet Hernández", ciudad: "Cúcuta" },
  "1126128743": { nombre: "Jhonnathans Guerrero", ciudad: "Cúcuta" },
  "1110452623": { nombre: "YOHANA ALEJANDRA COMBA CRINSTANCHO", ciudad: "Ibagué" },
  "42844263": { nombre: "Nancy Milena Giraldo Carvajal", ciudad: "Marinilla" },
  "1192716334": { nombre: "Jhary Tatiana Calderon Rodriguez", ciudad: "Saravena" },
  "1005874218": { nombre: "Juan Pablo Rengifo Montoya", ciudad: "Santiago de Cali" },
  "1067949524": { nombre: "Natalia andrea Carrascal alvarez", ciudad: "Montería" },
  "1018455710": { nombre: "Karen Andrea Pérez Rodas", ciudad: "Inírida" },
  "1053324619": { nombre: "Yamile Cortes", ciudad: "Chiquinquirá" },
  "1193117479": { nombre: "Stefania Ardila Rojas", ciudad: "MEDELLÍN" },
  "43918115": { nombre: "Nelly Sanchez Mesa", ciudad: "MEDELLÍN" },
  "1128427151": { nombre: "Natalia Valderrama Bedoya", ciudad: "MEDELLÍN" },
  "1000636524": { nombre: "Daniela María Sanchez Ortiz", ciudad: "MEDELLÍN" },
  "1037626812": { nombre: "Yesika Correa", ciudad: "MEDELLÍN" },
  "1152461763": { nombre: "Karina Bedoya taborda", ciudad: "MEDELLÍN" },
  "1214729031": { nombre: "Camila Paniagua", ciudad: "MEDELLÍN" },
  "1015071003": { nombre: "Isabella Castro", ciudad: "MEDELLÍN" },
  "42825498": { nombre: "Carolina Suaza", ciudad: "MEDELLÍN" },
  "1017172088": { nombre: "Ana maria Arbelaez ochoa", ciudad: "MEDELLÍN" },
  "1001418863": { nombre: "Maria Cortes", ciudad: "MEDELLÍN" },
  "26124131": { nombre: "Adriana Valentina Arellano", ciudad: "MEDELLÍN" },
  "1020302843": { nombre: "Emiliana Ocampo posada", ciudad: "MEDELLÍN" },
  "43188284": { nombre: "kelly Andrea Zapata Rios", ciudad: "MEDELLÍN" },
  "1152224617": { nombre: "Manuela Osorno", ciudad: "MEDELLÍN" },
  "1017274189": { nombre: "Natalia Aristizabal Ospina", ciudad: "MEDELLÍN" },
  "1036395323": { nombre: "Manuela Villegas Londoño", ciudad: "MEDELLÍN" },
  "1001445926": { nombre: "Juliana Arbelaez Ramirez", ciudad: "MEDELLÍN" },
  "1013656440": { nombre: "Karina Olarte", ciudad: "MEDELLÍN" },
  "1152212243": { nombre: "Brenda Guarnizo", ciudad: "MEDELLÍN" },
  "1152226268": { nombre: "Camila Tabares", ciudad: "MEDELLÍN" },
  "1083918259": { nombre: "Maria Alejandra Malambo Guzman", ciudad: "MEDELLÍN" },
  "1025662944": { nombre: "Marianna Monsalve Loaiza", ciudad: "MEDELLÍN" },
  "1128479298": { nombre: "Laura Suarez", ciudad: "MEDELLÍN" },
  "1128436468": { nombre: "Leidy castaño", ciudad: "MEDELLÍN" },
  "1032013539": { nombre: "Karen Juliana Lopez Padilla", ciudad: "MEDELLÍN" },
  "1018346032": { nombre: "Tatiana Cuartas", ciudad: "MEDELLÍN" },
  "1020392656": { nombre: "Heidi Tatiana De la Barrera", ciudad: "MEDELLÍN" },
  "1017226218": { nombre: "María camila", ciudad: "MEDELLÍN" },
  "1023592708": { nombre: "Isabella Patiño", ciudad: "MEDELLÍN" },
  "1045519682": { nombre: "Patricia Lopez", ciudad: "MEDELLÍN" },
  "1035770754": { nombre: "Valentina Tamayo Jaramillo", ciudad: "MEDELLÍN" },
  "1017139286": { nombre: "Alexandra Gomez", ciudad: "MEDELLÍN" },
  "1017243557": { nombre: "Valentina Posada siegra", ciudad: "MEDELLÍN" },
  "1007055361": { nombre: "Valentina Rico", ciudad: "MEDELLÍN" },
  "1000565410": { nombre: "Laura Giraldo bolivar", ciudad: "MEDELLÍN" },
  "1037654693": { nombre: "Kimberly Perez", ciudad: "MEDELLÍN" },
  "1034285103": { nombre: "Susana Aguilar Roldán", ciudad: "MEDELLÍN" },
  "1128224543": { nombre: "Yusmila Pinzón sarmiento", ciudad: "MEDELLÍN" },
  "43864546": { nombre: "Angela Maria Orozco Hidalgo", ciudad: "MEDELLÍN" },
  "1214733631": { nombre: "Kelly Arango", ciudad: "MEDELLÍN" },
  "1020479133": { nombre: "Diana Franco", ciudad: "MEDELLÍN" },
  "1038103943": { nombre: "Mary Luz Adechine", ciudad: "MEDELLÍN" },
  "1000903129": { nombre: "Manuela Ospina Guzmán", ciudad: "MEDELLÍN" },
  "1017241054": { nombre: "Daniela Cardona", ciudad: "MEDELLÍN" },
  "1007054708": { nombre: "Ana sofia Cardona perez", ciudad: "MEDELLÍN" },
  "1035433744": { nombre: "Karen Tavera", ciudad: "MEDELLÍN" },
  "1035973803": { nombre: "Yeraldin Agudelo López", ciudad: "MEDELLÍN" },
  "1152443667": { nombre: "Manuela López Muñoz", ciudad: "MEDELLÍN" },
  "1000193974": { nombre: "Manuela Perez palacio", ciudad: "MEDELLÍN" },
  "1036649933": { nombre: "ALEJANDRA VELEZ PEREZ", ciudad: "MEDELLÍN" },
  "1035878816": { nombre: "Maria Alejandra Salazar Alzate", ciudad: "MEDELLÍN" },
  "1003815057": { nombre: "Angie Noscue", ciudad: "MEDELLÍN" },
  "1001244494": { nombre: "Duban Gomez", ciudad: "MEDELLÍN" },
  "1000193061": { nombre: "Carol giraldo", ciudad: "MEDELLÍN" },
  "1037650398": { nombre: "Tatiana alejandra Lopez restrepo", ciudad: "MEDELLÍN" },
  "1214741802": { nombre: "Jessica Valentina Gil Grisales", ciudad: "MEDELLÍN" },
  "1152464337": { nombre: "Isabel Gutierrez", ciudad: "MEDELLÍN" },
  "1214748551": { nombre: "Luisa Agudelo Arias", ciudad: "MEDELLÍN" },
  "1105353406": { nombre: "Valentina Zora Uribe", ciudad: "MEDELLÍN" },
  "1214742415": { nombre: "Alejandra Castañeda garcia", ciudad: "MEDELLÍN" },
  "43300311": { nombre: "Diana Metaute", ciudad: "MEDELLÍN" },
  "1152692738": { nombre: "Erika Jhoanna Perez Serna", ciudad: "MEDELLÍN" },
  "1037639717": { nombre: "Juliana Andrea Sánchez Ramírez", ciudad: "MEDELLÍN" },
  "1152439103": { nombre: "Juliana Madrigal Vélez", ciudad: "MEDELLÍN" },
  "1000397452": { nombre: "Emily Morelos", ciudad: "MEDELLÍN" },
  "1020419351": { nombre: "Isabel Cristina", ciudad: "MEDELLÍN" },
  "43973331": { nombre: "Carolina Bedoya", ciudad: "MEDELLÍN" },
  "1036424737": { nombre: "Fernanda Martirnez", ciudad: "MEDELLÍN" },
  "1037598461": { nombre: "Isabel Gallego", ciudad: "MEDELLÍN" },
  "1020222848": { nombre: "Karen Guerra", ciudad: "MEDELLÍN" },
  "1001687045": { nombre: "Sara Yepes Berrio", ciudad: "MEDELLÍN" },
  "43597151": { nombre: "Claudia Zapata", ciudad: "MEDELLÍN" },
  "1035230789": { nombre: "Greicy Cardenas", ciudad: "MEDELLÍN" },
  "1023528612": { nombre: "Hellen Guerra Ospina", ciudad: "MEDELLÍN" },
  "1001808465": { nombre: "Esmeralda Aristizabal", ciudad: "MEDELLÍN" },
  "1017261087": { nombre: "Lina Vanegas", ciudad: "MEDELLÍN" },
  "1128421942": { nombre: "cindy carolina Duque", ciudad: "MEDELLÍN" },
  "1033178677": { nombre: "Camila Andrea Gonzalez Pineda", ciudad: "MEDELLÍN" },
  "1017255194": { nombre: "Laura Ochoa", ciudad: "MEDELLÍN" },
  "1127454441": { nombre: "Carolina Arango", ciudad: "MEDELLÍN" },
  "1048264533": { nombre: "Dariana Nayduth Castaño Mira", ciudad: "MEDELLÍN" },
  "1000899616": { nombre: "Ximena Cano Moreno", ciudad: "MEDELLÍN" },
  "42692170": { nombre: "pilar londoño", ciudad: "MEDELLÍN" },
  "1073628235": { nombre: "Lily Mariana Aristizabal", ciudad: "MEDELLÍN" },
  "1067095807": { nombre: "Dariana Sanchez Toscano", ciudad: "MEDELLÍN" },
  "1020103057": { nombre: "Jimena Bolívar Henao", ciudad: "MEDELLÍN" },
  "1128443325": { nombre: "CRISTINA SALAS", ciudad: "MEDELLÍN" },
  "6974507": { nombre: "Soley López", ciudad: "MEDELLÍN" },
  "1035875615": { nombre: "Maria Camila Salazar", ciudad: "MEDELLÍN" },
  "1037449922": { nombre: "Claudia Orrego", ciudad: "MEDELLÍN" },
  "1001015196": { nombre: "Paola Restrepo", ciudad: "MEDELLÍN" },
  "1152225261": { nombre: "Valentina henao ochoa", ciudad: "MEDELLÍN" },
  "1128483669": { nombre: "Claudia LOPEZ", ciudad: "MEDELLÍN" },
  "1036252274": { nombre: "Sofia Giraldo londoño", ciudad: "MEDELLÍN" },
  "43978990": { nombre: "Tatiana Gonzalez", ciudad: "MEDELLÍN" },
  "1152448014": { nombre: "Maria Fernanda TAVERA", ciudad: "MEDELLÍN" },
  "1017211529": { nombre: "Natalia Alvarez Alvarez", ciudad: "MEDELLÍN" },
  "1007940687": { nombre: "sara palacio", ciudad: "MEDELLÍN" },
  "1214736246": { nombre: "Alejandra Orozco", ciudad: "MEDELLÍN" },
  "1017267088": { nombre: "Serna Leidy", ciudad: "MEDELLÍN" },
  "1041631070": { nombre: "Manuela Rodriguez", ciudad: "MEDELLÍN" },
  "1021922774": { nombre: "Isabella Castro Velasquez", ciudad: "MEDELLÍN" },
  "1059712664": { nombre: "Melisa Franco", ciudad: "MEDELLÍN" },
  "1000547259": { nombre: "Alejandra Serna", ciudad: "MEDELLÍN" },
  "1128456275": { nombre: "Andrea Mejía", ciudad: "MEDELLÍN" },
  "1000020654": { nombre: "Valentina Sanjuan", ciudad: "MEDELLÍN" },
  "1020814732": { nombre: "Daniela Salgado Gaitan", ciudad: "Villavicencio" },
  "901958366": { nombre: "Tania Marquez S.A.S", ciudad: "Pereira" },
  "1005572694": { nombre: "Danna Hernandez Ramirez", ciudad: "Galeras" },
  "1014299657": { nombre: "Carolina Meneses Reyes", ciudad: "Granada" },
  "1124020709": { nombre: "Vanessa Gutierrez Guerrero", ciudad: "Medellín" },
  "8784216": { nombre: "Saritza Maria Flores De Alvaro", ciudad: "Cúcuta" },
  "1002192016": { nombre: "Pamela Restrepo Arnedo", ciudad: "Cartagena de Indias" },
  "1098809998": { nombre: "Dayanna Villamizar", ciudad: "Bucaramanga" },
  "1018493533": { nombre: "Laura Daniela Lopez Pineda", ciudad: "Bogotá, D.C." },
  "39448545": { nombre: "ASTRID BIBIANA RAVE DELGADO", ciudad: "Rionegro" },
  "1019041334": { nombre: "Adriana Osorio", ciudad: "BELLO" },
  "1036670684": { nombre: "Yesenia Jaramillo", ciudad: "SABANETA" },
  "1037641777": { nombre: "Stefania Muñoz Rodriguez", ciudad: "MEDELLÍN" },
  "1037618250": { nombre: "Carolina Radi rivera", ciudad: "SABANETA" },
  "1144076351": { nombre: "María Camila Valencia", ciudad: "ENVIGADO" },
  "1007918996": { nombre: "Mariana Carvajal Ciro", ciudad: "MEDELLÍN" },
  "1035390065": { nombre: "Mariana Lugo Alzate", ciudad: "SABANETA" },
  "1037591862": { nombre: "Stephanie Acevedo Cuervo", ciudad: "ENVIGADO" },
  "1007102122": { nombre: "Isamar Echavarria", ciudad: "ITAGÜÍ" },
  "1126599926": { nombre: "Lina maria Agudelo guisao", ciudad: "MEDELLÍN" },
  "1001368385": { nombre: "Isabela Orrego", ciudad: "MEDELLÍN" },
  "1005565504": { nombre: "ALEXANDRA GARCIA", ciudad: "ITAGÜÍ" },
  "1152697718": { nombre: "Lizeth Caro Londoño", ciudad: "MEDELLÍN" },
  "1036668975": { nombre: "Tatiana Sánchez", ciudad: "BELLO" },
  "1130724215": { nombre: "Laura Camila Cataño Correa", ciudad: "BELLO" },
  "1000870366": { nombre: "Susana Rojas perez", ciudad: "MEDELLÍN" },
  "1192776978": { nombre: "Leidy Dayana Jaramillo", ciudad: "BELLO" },
  "1022142927": { nombre: "Yulieth Vasquez", ciudad: "MEDELLÍN" },
  "1037608614": { nombre: "sara daniela vasquez arango", ciudad: "ITAGÜÍ" },
  "71339767": { nombre: "Edwin Correa Santana", ciudad: "MEDELLÍN" },
  "1001250178": { nombre: "Sara Tobón", ciudad: "BELLO" },
  "1001250178": { nombre: "Jennyfer Duque", ciudad: "SABANETA" },
  "1000655048": { nombre: "Manuela gomez uribe", ciudad: "ENVIGADO" },
  "1045050122": { nombre: "Luisa fernanda Garcia osorio", ciudad: "ITAGÜÍ" },
  "1144072992": { nombre: "Daniela Palacios Calvo", ciudad: "SABANETA" },
  "1035974227": { nombre: "ANGELLY DAYANA VILLA GOMEZ", ciudad: "ENVIGADO" },
  "1001250533": { nombre: "Isabella Carvajal", ciudad: "BELLO" },
  "1017139286": { nombre: "Alexandra Gomez", ciudad: "MEDELLÍN" },
  "1017228755": { nombre: "Nataly Ríos Moreno", ciudad: "BELLO" },
  "222222222222": { nombre: "Viviana Andrea Rodas Escobar", ciudad: "MEDELLÍN" },
  "1055833597": { nombre: "Ana Pineda Galbis", ciudad: "ENVIGADO" },
  "1020472458": { nombre: "Tatiana Lora", ciudad: "BELLO" },
  "1036651213": { nombre: "Kelly Vanessa Vahos Rua", ciudad: "ITAGÜÍ" },
  "222222222222": { nombre: "Milena Mira", ciudad: "MEDELLÍN" },
  "1036448776": { nombre: "Mariana Rios", ciudad: "MEDELLÍN" },
  "1193124195": { nombre: "Evelyn Henao Hoyos", ciudad: "BELLO" },
  "1039468408": { nombre: "Maria Camila Aristizabal Rotavista", ciudad: "BELLO" },
  "1000414369": { nombre: "Estefania Nauzan Escobar", ciudad: "BELLO" },
  "1037613211": { nombre: "Daniela Gutierrez", ciudad: "SABANETA" },
  "1000569092": { nombre: "Melisa Jaramillo Villa", ciudad: "BELLO" },
  "1017238590": { nombre: "Juliana Rodriguez Segura", ciudad: "BELLO" },
  "222222222222": { nombre: "Alfaris Gomez", ciudad: "ENVIGADO" },
  "1053862486": { nombre: "Maria camila Guevara alzate", ciudad: "SABANETA" },
  "32257709": { nombre: "Brenda Naranjo Perez", ciudad: "MEDELLÍN" },
  "1037666227": { nombre: "Maira Alejandra Carrion Gabanzo", ciudad: "ITAGÜÍ" },
  "1035437184": { nombre: "Valentina Díaz Montoya", ciudad: "BELLO" },
  "1007242127": { nombre: "Denny Restrepo", ciudad: "BELLO" },
  "32299381": { nombre: "Veronica Patino", ciudad: "ENVIGADO" },
  "1092454032": { nombre: "Manuela Yepez", ciudad: "ITAGÜÍ" },
  "1004925161": { nombre: "Gabriela Gamboa Rangel", ciudad: "ENVIGADO" },
  "1032425568": { nombre: "CAROL BIBIANA CHIPATECUA MOLINA", ciudad: "ITAGÜÍ" },
  "1036609419": { nombre: "Lady johanna Estrada Álvarez", ciudad: "ITAGÜÍ" },
  "1001468359": { nombre: "Daniela Suárez Zapata", ciudad: "ENVIGADO" },
  "1001011318": { nombre: "María Helena Restrepo", ciudad: "ITAGÜÍ" },
  "1017252525": { nombre: "Juliana Galeano Hernandez", ciudad: "ENVIGADO" },
  "1193404135": { nombre: "Tatiana Herrera", ciudad: "BELLO" },
  "1017238590": { nombre: "Juliana Rodriguez Segura", ciudad: "BELLO" },
  "10376555318": { nombre: "Manuela Roldan", ciudad: "MEDELLÍN" },
  "1017922580": { nombre: "isabella osorio ospina", ciudad: "ENVIGADO" },
  "1017238590": { nombre: "Juliana Rodriguez Segura", ciudad: "BELLO" },
  "1017238590": { nombre: "Juliana Rodriguez Segura", ciudad: "BELLO" },
  "1036657443": { nombre: "Estefanía Muñoz Castañeda", ciudad: "MEDELLÍN" },
  "1214715646": { nombre: "Isabel Arango López", ciudad: "MEDELLÍN" },
  "43189935": { nombre: "Nataly Yepes", ciudad: "MEDELLÍN" },
  "1036686049": { nombre: "meliza suaza", ciudad: "MEDELLÍN" },
  "1036610562": { nombre: "Luisa Espinosa", ciudad: "MEDELLÍN" },
  "1011393616": { nombre: "Tania González Cuartas", ciudad: "MEDELLÍN" },
  "1193404135": { nombre: "Tatiana Herrera", ciudad: "BELLO" },
  "222222222222": { nombre: "Luisa Atehortua", ciudad: "MEDELLÍN" },
  "1037646823": { nombre: "Maria Maria Vasquez", ciudad: "MEDELLÍN" },
  "1020441764": { nombre: "Ana Carolina Valencia Restrepo", ciudad: "BELLO" },
  "1040757370": { nombre: "Daniela Montes", ciudad: "MEDELLÍN" },
  "1042066642": { nombre: "Yesica Alejandra Arango Serna", ciudad: "BELLO" },
  "43999295": { nombre: "Alix Franco", ciudad: "MEDELLÍN" },
  "1000397790": { nombre: "Ana María Toro", ciudad: "MEDELLÍN" },
  "1017247417": { nombre: "Christian Carmona Rico", ciudad: "MEDELLÍN" },
  "1036651213": { nombre: "Kelly Vanessa Vahos Rua", ciudad: "ITAGÜÍ" },
  "43094020": { nombre: "Karit Buitrago", ciudad: "ENVIGADO" },
  "1018223893": { nombre: "Natasha Agudelo mejia", ciudad: "MEDELLÍN" },
  "1035438240": { nombre: "Ana milena Patiño", ciudad: "MEDELLÍN" },
  "1001160786": { nombre: "Mariana Castillo B", ciudad: "MEDELLÍN" },
  "1000442758": { nombre: "Sara Bedoya Tamayo", ciudad: "MEDELLÍN" },
  "1031941714": { nombre: "Sofia Perez", ciudad: "MEDELLÍN" },
  "1214714725": { nombre: "Tatiana Loaiza", ciudad: "MEDELLÍN" },
  "1121890302": { nombre: "Estefany Aguirre", ciudad: "ITAGÜÍ" },
  "1128275640": { nombre: "Sandra Marcela Zuleta Carreño", ciudad: "MEDELLÍN" },
  "66724168": { nombre: "Paula Andre Parra Duque", ciudad: "Armenia" },
  "1006788055": { nombre: "Jhoana Guajala", ciudad: "San Miguel" },
  "1131224210": { nombre: "Luciana Valderrama", ciudad: "Medellín" },
  "1042763527": { nombre: "Pablo Andrés Gómez Álvarez", ciudad: "La Ceja" },
  "901795272": { nombre: "Drogueria Benevento Sas Estefany Palacios", ciudad: "Bello" },
  "43112464": { nombre: "Adriana Isabel Berrio", ciudad: "Itagüí" },
  "1082104915": { nombre: "Yesenia Coral", ciudad: "Ipiales" },
  "1026585661": { nombre: "Juan David Duque Cuellar", ciudad: "Bogotá, D.C." },
  "1037649866": { nombre: "Wilson Alexander Lopez Gomez", ciudad: "Medellín" },
  "79095550": { nombre: "CARLOS JULIO PRIETO TORRES", ciudad: "La Mesa" },
  "901439013": { nombre: "Importadora Y Distribuidora Mega Sas", ciudad: "Medellín" },
  "18522535": { nombre: "Jonathan Valencia Torres", ciudad: "Pereira" },
  "53072030": { nombre: "Karen Jhoanna Morales", ciudad: "Mosquera" },
  "901802318": { nombre: "DANY AMAYA", ciudad: "" },
  "1022351737": { nombre: "Paula Gonzalez", ciudad: "Bogotá, D.C." },
  "43149133": { nombre: "SILVIA NATALIA LONDOÑO", ciudad: "Chigorodó" },
  "53038182": { nombre: "Yuli Patricia Villar Monroy", ciudad: "Bogotá, D.C." },
  "1020817135": { nombre: "Camila Alejandra Martinez Ospina", ciudad: "Bogotá, D.C." },
  "1018342796": { nombre: "Leidy Cortes", ciudad: "Amalfi" },
  "1065582147": { nombre: "Maria Angelica Cotes Meza", ciudad: "Valledupar" },
  "1113528656": { nombre: "Karen Tatiana Vivas Hernandez", ciudad: "Candelaria" },
  "1036640418": { nombre: "Erika Rodriguez", ciudad: "ITAGÜÍ" },
  "1036642181": { nombre: "Vanessa Vanegas", ciudad: "ITAGÜÍ" },
  "1036642649": { nombre: "Luisa Uribe Castaño", ciudad: "ITAGÜÍ" },
  "1042774076": { nombre: "Natalia Moreno", ciudad: "BELLO" },
  "1037633899": { nombre: "ALEJANDRa Madrid Madrid", ciudad: "ENVIGADO" },
  "1001359732": { nombre: "Laura Cristina llanos osorio", ciudad: "BELLO" },
  "1152688503": { nombre: "Johana Cordoba", ciudad: "MEDELLÍN" },
  "1214721483": { nombre: "Manuela Arboleda", ciudad: "SABANETA" },
  "1037671903": { nombre: "Mariana Vásquez Miranda", ciudad: "ENVIGADO" },
  "1017269702": { nombre: "Ana Zuluaga", ciudad: "BELLO" },
  "1125789328": { nombre: "Marilyn Aristizabal", ciudad: "ENVIGADO" },
  "1017214897": { nombre: "Daniela Rodriguez Jaramillo", ciudad: "BELLO" },
  "1001469752": { nombre: "Isabel Cristina Toro", ciudad: "ITAGÜÍ" },
  "1000087622": { nombre: "Camila Gomez", ciudad: "MEDELLÍN" },
  "1001577097": { nombre: "juanita Jaramillo", ciudad: "ITAGÜÍ" },
  "1036629382": { nombre: "Viviana Espinosa", ciudad: "ITAGÜÍ" },
  "1020487868": { nombre: "Natalia Velásquez", ciudad: "BELLO" },
  "1036612316": { nombre: "Elizabeth Zapata Ospina", ciudad: "BELLO" },
  "1022002985": { nombre: "Ana Sofia Rendon Duque", ciudad: "ENVIGADO" },
  "1000902614": { nombre: "Juliana Betancur", ciudad: "MEDELLÍN" },
  "1020483459": { nombre: "Laura Ardila", ciudad: "BELLO" },
  "1000653733": { nombre: "Anyie Valencia Bustamante", ciudad: "BELLO" },
  "1000752630": { nombre: "Wendy Betancur", ciudad: "MEDELLÍN" },
  "1128397474": { nombre: "Estefanny Barrientos", ciudad: "BELLO" },
  "1036662022": { nombre: "laura patiño", ciudad: "BELLO" },
  "53107466": { nombre: "ANDREA valenzuela", ciudad: "ENVIGADO" },
  "1013343750": { nombre: "paulina puertas", ciudad: "MEDELLÍN" },
  "1017217701": { nombre: "Valentina Flórez Calle", ciudad: "MEDELLÍN" },
  "1001455803": { nombre: "daniela zuluaga", ciudad: "BELLO" },
  "1085311885": { nombre: "Erika Benavides", ciudad: "MEDELLÍN" },
  "1033180723": { nombre: "Mariana Montoya", ciudad: "MEDELLÍN" },
  "41953406": { nombre: "Valery Marín Mazo", ciudad: "MEDELLÍN" },
  "1037574423": { nombre: "Natalia Bolivar gomez", ciudad: "ENVIGADO" },
  "1000085430": { nombre: "mariana Madrid", ciudad: "MEDELLÍN" },
  "1067955916": { nombre: "Mario Diaz", ciudad: "BELLO" },
  "1000536473": { nombre: "stefania Buitrago Restrepo", ciudad: "ITAGÜÍ" },
  "1018224980": { nombre: "laura patiño", ciudad: "BELLO" },
  "1023629398": { nombre: "Maria camila Hernandez usuga", ciudad: "MEDELLÍN" },
  "40327488": { nombre: "Pilar Navarro", ciudad: "MEDELLÍN" },
  "1152206488": { nombre: "Katherin Bedoya", ciudad: "BELLO" },
  "1040747201": { nombre: "Vanessa Rivera", ciudad: "SABANETA" },
  "1036953888": { nombre: "Maria Fernanda Urrea", ciudad: "SABANETA" },
  "43974523": { nombre: "Eliana Giraldo Calle", ciudad: "MEDELLÍN" },
  "1025640376": { nombre: "Fiama Velez", ciudad: "MEDELLÍN" },
  "1001359241": { nombre: "Valentina Rodriguez", ciudad: "MEDELLÍN" },
  "1000445952": { nombre: "Yudi Elena Morales Acevedo", ciudad: "BELLO" },
  "1152450568": { nombre: "Carolina Rendon", ciudad: "SABANETA" },
  "1001469068": { nombre: "Yomara Ríos vasco", ciudad: "MEDELLÍN" },
  "32106938": { nombre: "Manuela Muñoz", ciudad: "ITAGÜÍ" },
  "1037073974": { nombre: "Leidy Garcia", ciudad: "MEDELLÍN" },
  "1036640160": { nombre: "Estefania Bernal", ciudad: "MEDELLÍN" },
  "1040750107": { nombre: "María Alejandra Hidalgo", ciudad: "SABANETA" },
  "1128430511": { nombre: "TATIANA MARIN", ciudad: "MEDELLÍN" },
  "1037638880": { nombre: "Yeraldin Tirado", ciudad: "ENVIGADO" },
  "1036602908": { nombre: "Angela Sanchez betancur", ciudad: "ITAGÜÍ" },
  "1053786709": { nombre: "luisa fenanda duque acevedo", ciudad: "MEDELLÍN" },
  "1072704453": { nombre: "Natalia Rodriguez", ciudad: "MEDELLÍN" },
  "1036617654": { nombre: "Lady Molina", ciudad: "ENVIGADO" },
  "1037611682": { nombre: "Monica Giraldo", ciudad: "MEDELLÍN" },
  "1054681546": { nombre: "Lorena Ruiz", ciudad: "SABANETA" },
  "1017228390": { nombre: "ANA ACEVEDO", ciudad: "MEDELLÍN" },
  "1000439747": { nombre: "Johana Arboleda", ciudad: "BELLO" },
  "1007286336": { nombre: "Daniela Arenas Pineda", ciudad: "MEDELLÍN" },
  "1128416023": { nombre: "ana loaiza", ciudad: "MEDELLÍN" },
  "10222006279": { nombre: "Isabella Quiñones herrera", ciudad: "MEDELLÍN" },
  "1152470029": { nombre: "Geraldine Arango", ciudad: "ENVIGADO" },
  "32299317": { nombre: "Carolina Hernández", ciudad: "SABANETA" },
  "1013358247": { nombre: "Stefany Jou Gaviria", ciudad: "MEDELLÍN" },
  "1037661378": { nombre: "Vanessa Ospina", ciudad: "ITAGÜÍ" },
  "44001969": { nombre: "Andrea Cardona", ciudad: "MEDELLÍN" },
  "1152459394": { nombre: "Luisa Restrepo", ciudad: "MEDELLÍN" },
  "1017268517": { nombre: "Isabela Echavarría Tabarez", ciudad: "BELLO" },
  "1006502805": { nombre: "Karol Novoa", ciudad: "MEDELLÍN" },
  "1020463124": { nombre: "Karen estefania Rodriguez cuartas", ciudad: "MEDELLÍN" },
  "43871983": { nombre: "Elizabeth Yepes", ciudad: "MEDELLÍN" },
  "1033488749": { nombre: "Samara Mora", ciudad: "BELLO" },
  "1037751087": { nombre: "Margarita Romero", ciudad: "MEDELLÍN" },
  "43878947": { nombre: "ERIKA PAVONY", ciudad: "MEDELLÍN" },
  "1013342274": { nombre: "Sara Cristina Bohorquez velez", ciudad: "MEDELLÍN" },
  "43607935": { nombre: "Marinela Marinela Rodríguez", ciudad: "ITAGÜÍ" },
  "1035440166": { nombre: "Tatiana Urrea", ciudad: "MEDELLÍN" },
  "1037623931": { nombre: "SARAY DAHIANA MUNERA RUA", ciudad: "ENVIGADO" },
  "1020435309": { nombre: "katerin peñuela", ciudad: "MEDELLÍN" },
  "1013658183": { nombre: "Heidy Valencia", ciudad: "MEDELLÍN" },
  "1037647629": { nombre: "Maria Alejandra Santos Ramon", ciudad: "ENVIGADO" },
  "21500796": { nombre: "Diana Holguin", ciudad: "ITAGÜÍ" },
  "1214720454": { nombre: "Liliana Paola Pérez", ciudad: "MEDELLÍN" },
  "1152201021": { nombre: "Alejandra Ospino", ciudad: "MEDELLÍN" },
  "1128418070": { nombre: "Paola Andréa Rivera", ciudad: "BELLO" },
  "1001456593": { nombre: "Manuela Sanchez", ciudad: "ITAGÜÍ" },
  "1152704098": { nombre: "Claudia Zapata", ciudad: "MEDELLÍN" },
  "1152704579": { nombre: "Yesica Metaute", ciudad: "MEDELLÍN" },
  "43532649": { nombre: "Diana Patricia Callejas Garcia", ciudad: "MEDELLÍN" },
  "1004766912": { nombre: "Andrea Castaño", ciudad: "BELLO" },
  "1001456545": { nombre: "Leslie Bedoya muñoz", ciudad: "MEDELLÍN" },
  "1095825525": { nombre: "Slendy Cardenas", ciudad: "ITAGÜÍ" },
  "1017131059": { nombre: "Elizabeth González Tobon", ciudad: "MEDELLÍN" },
  "1152713674": { nombre: "Yuranny Andrea Restrepo Garcia", ciudad: "MEDELLÍN" },
  "100294648": { nombre: "Valentina Ocampo", ciudad: "MEDELLÍN" },
  "1152210535": { nombre: "Yurani andrea Muñoz alvarez", ciudad: "MEDELLÍN" },
  "1035438069": { nombre: "Stephania Herrera Rios", ciudad: "BELLO" },
  "901883014": { nombre: "KRIKA CENTRO", ciudad: "CALI" },
  "1000756348": { nombre: "MARIA ISABEL RUIZ RINCON", ciudad: "MEDELLÍN" },
  "1001227151": { nombre: "STEFANNY ORREGO ZORA", ciudad: "MEDELLÍN" },
  "1004845181": { nombre: "JULIANA GARCIA", ciudad: "MEDELLÍN" },
  "1017228932": { nombre: "DANIELA BARRERA", ciudad: "BELLO" },
  "1020428618": { nombre: "VANESSA MANRIQUE VALENCIA", ciudad: "MEDELLÍN" },
  "1020484655": { nombre: "CAROLINA MARIN ZEA", ciudad: "BELLO" },
  "1036685359": { nombre: "JULIANA AMDREA BEDOYA GARCIA", ciudad: "BELLO" },
  "1037614242": { nombre: "YULIANA RESTREPO BUILES", ciudad: "ENVIGADO" },
  "1039457268": { nombre: "VERÓNICA LALINDE CALLE", ciudad: "ENVIGADO" },
  "1039474335": { nombre: "SARAY LIDUEÑA", ciudad: "ITAGÜÍ" },
  "1128397954": { nombre: "LUISA FERNANDA OTALVARO JIMENEZ", ciudad: "BELLO" },
  "1193105991": { nombre: "AHIDE BETANCUR", ciudad: "ITAGÜÍ" },
  "1193579952": { nombre: "MELISSA OSORIO", ciudad: "BELLO" },
  "43094020-1": { nombre: "MAGNOLIA CASTAÑO", ciudad: "ENVIGADO" },
  "1121909517": { nombre: "HERMAN ERNEY MONTEALEGRE", ciudad: "San José del Guaviare" },
  "2100939038": { nombre: "Victoria Alejandra Santillan Urgiles", ciudad: "Valle del Guamuez" },
  "901724577": { nombre: "GRUPO FYX S.A.S ZOMAC", ciudad: "Medellín" },
  "1216726146": { nombre: "Mariana Garcia Lopez", ciudad: "Barbosa" },
  "1085945635": { nombre: "Angie Carolina Oviedo Lopez", ciudad: "Túquerres" },
  "53931853": { nombre: "Yaddy Viviana Castillo Guchuvo", ciudad: "Fusagasugá" },
  "1054566496": { nombre: "Daniela Sanchez", ciudad: "La Dorada" },
  "1006997025": { nombre: "Marlin Yineth Guaranguay Figueroa", ciudad: "Valle del Guamuez" },
  "1031127224": { nombre: "David Camilo Leal Narvaez", ciudad: "Bogotá, D.C." },
  "52210902": { nombre: "Sandra Yaneth Araoz Useche", ciudad: "Bogotá, D.C." },
  "3212084030": { nombre: "AMALIA ARANGO", ciudad: "medellin" },
  "901967511": { nombre: "Quich Store", ciudad: "Villa de San Diego de Ubaté" },
  "43183045": { nombre: "BIVIANA ARANGO", ciudad: "SABANETA" },
  "42077080": { nombre: "RUBIELA USMAN", ciudad: "Pereira" },
  "1093759464": { nombre: "Eliana Reyes Cordero", ciudad: "San José de Cúcuta" },
  "1022323161": { nombre: "Deissy Ramirez Montoya", ciudad: "Villavicencio" },
  "901548500": { nombre: "Guaragna Sas", ciudad: "Santa Marta" },
  "1002085207": { nombre: "Juan Jose Mejia Jimenez", ciudad: "Tarazá" },
  "1053860940": { nombre: "Laura Juliana Quiceno Galviz", ciudad: "Manizales" },
  "1118553295": { nombre: "Carolina Durango", ciudad: "Yopal" },
  "1036679304": { nombre: "Susana Mesa Sierra", ciudad: "Itagüí" },
  "1003804218": { nombre: "ALEJANDRA GIRALDO", ciudad: "San Carlos" },
  "1024531902": { nombre: "Ana Maria Garibello Munoz", ciudad: "Soacha" },
  "1088301545": { nombre: "Yessica Moncada", ciudad: "Pereira" },
  "1091683459": { nombre: "Anyela mairuth Carreño Coronel", ciudad: "Ocaña" },
  "80774748": { nombre: "Diego Fernando Villareal", ciudad: "Bucaramanga" },
  "901370080": { nombre: "Estefany Cifuentes", ciudad: "CALI" },
  "1010240431": { nombre: "Daniela Aguilar", ciudad: "Bogotá, D.C." },
  "1143373764": { nombre: "Moisés de Jesús Morelos Saenz", ciudad: "Cartagena de Indias" },
  "1088280287": { nombre: "Johana Agudelo", ciudad: "Pereira" },
  "901467182": { nombre: "Kika Cosmeticos Sas", ciudad: "Buenaventura" },
  "1094932135": { nombre: "Viviana Choconta Franco", ciudad: "Armenia" },
  "1113307382": { nombre: "Carolina Acosta Velez", ciudad: "Sevilla" },
  "80850239": { nombre: "Ken Lenis (Jennifer Giraldo)", ciudad: "Cali" },
  "901802943": { nombre: "Vitom Sas", ciudad: "Leticia" },
  "42162520": { nombre: "Eliana criollo Aguirre", ciudad: "Rionegro" },
  "1110569762": { nombre: "Johana Burgos", ciudad: "Ibagué" },
  "70827903": { nombre: "Maria Alejandra Ramirez", ciudad: "Santiago de Cali" },
  "1127457263": { nombre: "Nohely Carolina Vega Seluan", ciudad: "Ipiales" },
  "1026159891": { nombre: "Emanuel Salazar Aristizabal", ciudad: "Medellín" },
  "24687210": { nombre: "Claudia Milena Gonzalez Soto", ciudad: "El Doncello" },
  "1018494443": { nombre: "Angie Caycedo", ciudad: "Bogotá, D.C." },
  "1047429402": { nombre: "Rodrigo Merlano Villalobos", ciudad: "Cartagena de Indias" },
  "1124032497": { nombre: "valerie gutierrez", ciudad: "soledad" },
  "1018472489": { nombre: "Viviana Hernández Dirgua", ciudad: "Bogotá, D.C." },
  "1015068605": { nombre: "Jennifer Saldarriaga", ciudad: "Itagüí" },
  "1028033509": { nombre: "Karen Daniela Martinez Osorio", ciudad: "Apartadó" },
  "1033791890": { nombre: "Julieth Andrea Quente Mora", ciudad: "Bogotá, D.C." },
  "1143824838": { nombre: "Julieth Katerine Carvajal", ciudad: "Santiago de Cali" },
  "1053871835": { nombre: "Maria Fernanda Rodas Becerra", ciudad: "Riosucio" },
  "1076332723": { nombre: "Brenda Rodriguez", ciudad: "Istmina" },
  "1007288617": { nombre: "Ximena Cardenas", ciudad: "Chaparral" },
  "1022427856": { nombre: "Daniela Ospina", ciudad: "San Sebastián de Mariquita" },
  "1090495961": { nombre: "Stefanny Murcia Gómez", ciudad: "Cúcuta" },
  "31067304": { nombre: "Anny Liseth Montero", ciudad: "Cúcuta" },
  "1027892574": { nombre: "Katherine Munoz Castro", ciudad: "Andes" },
  "1118303519": { nombre: "Julieth Polanco", ciudad: "YUMBO" },
  "901501576-9": { nombre: "Variedades H Y S S.A.S", ciudad: "Medellín" },
  "1049619919": { nombre: "Eliana Lizeth Castañeda Alvarado", ciudad: "Duitama" },
  "1007294516": { nombre: "Valentina Vera Rodriguez", ciudad: "Pereira" },
  "1115914745": { nombre: "Zuly Katherine Garzón Martínez", ciudad: "yopal" },
  "1102724820": { nombre: "Laura Milena Macias Garnica", ciudad: "San Gil" },
  "1044392713": { nombre: "Luz Karime Villanueva", ciudad: "santa marta" },
  "1097039688": { nombre: "Lilivedt Rodríguez Tabares", ciudad: "Quimbaya" },
  "1098712018": { nombre: "Lizeth Cecilia Lopez Morales", ciudad: "Piedecuesta" },
  "17103979": { nombre: "Alejandra S", ciudad: "Medellín" },
  "1085275622": { nombre: "Olga Rodríguez", ciudad: "Medellín" },
  "1019148659": { nombre: "Stefania Viteri", ciudad: "Armenia" },
  "901587606": { nombre: "Iconika Beauty By Gc", ciudad: "Cartagena de Indias" },
  "1121943673": { nombre: "Valentina Gutiérrez", ciudad: "Villavicencio" },
  "1717556318": { nombre: "Laura Camila", ciudad: "Ipiales" },
  "1050959662": { nombre: "Maria Gomez Vergara", ciudad: "Turbaco" },
  "1116272567": { nombre: "Kimberly Garcia Londono", ciudad: "Tuluá" },
  "1002633914": { nombre: "Estefania Delgado Buitrago", ciudad: "Manizales" },
  "902034720": { nombre: "Johanna Garcia Paredes", ciudad: "Pereira" },
  "43537952244": { nombre: "Gloria Nacy Palacio Muñoz", ciudad: "belen medellin" },
  "1120873425": { nombre: "Karen Julissa Romero Vergara", ciudad: "Puerto López" },
  "1100397086": { nombre: "Maria Alejandra Guerra Herrera", ciudad: "Sincé" },
  "1087989644": { nombre: "Karol Viviana Sanchez Castrillon", ciudad: "Pereira" },
  "1086105375": { nombre: "Erika Carolina Morán Rodríguez", ciudad: "ipialis" },
  "16946360": { nombre: "Jhoan gabriel rodriguez arboleda", ciudad: "jamundi" },
  "1118868435": { nombre: "Camila Campo Mendoza", ciudad: "valledupar" },
  "901845603": { nombre: "AMISTA COSMETICS SAS", ciudad: "pereira" },
  "1121928945": { nombre: "Luisa Fernanda Mendoza", ciudad: "Istmina" }
};

// Helpers de búsqueda en BD
const buscarPorNit = (nit) => BD_CLIENTES[String(nit).trim()] || null;

// Busca en BD por nombrecliente (campo "Dirigido a" del PDF)
const buscarPorNombre = (nombreBuscar) => {
  if (!nombreBuscar) return null;
  const q = nombreBuscar.trim().toLowerCase();
  return Object.entries(BD_CLIENTES).find(([, v]) =>
    v.nombre.toLowerCase().includes(q)
  ) || null;
};

// ── Helpers de fecha ──
const pad = n => String(n).padStart(2, "0");
const generateFecha = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const generateSolicitud = () => {
  const d = new Date();
  return `${pad(d.getDate())}${pad(d.getMonth()+1)}${String(d.getFullYear()).slice(2)}${pad(d.getHours())}${pad(d.getMinutes())}`;
};
const up = v => typeof v === "string" ? v.toUpperCase() : v;

// ── Definición de columnas ──
const COLS = [
  { key: "entrega",      label: "Entrega",             placeholder: "OC-1-435",      width: "115px", required: true  },
  { key: "destinatario", label: "Destinatario (NIT)",   placeholder: "900313153",     width: "110px", required: true  },
  { key: "nombre",       label: "Nombre destinatario",  placeholder: "EMPRESA S.A.S", width: "188px", required: true  },
  { key: "lugar",        label: "Lugar",                placeholder: "MEDELLÍN",      width: "100px", required: true  },
  { key: "material",     label: "Material",             placeholder: "770MP0403",     width: "105px", required: true  },
  { key: "cantidad",     label: "Cantidad",             placeholder: "0",             width: "76px",  required: true, numeric: true },
  { key: "um",           label: "UM",                   placeholder: "BUL",           width: "54px"  },
  { key: "item",         label: "Ítem",                 placeholder: "1001",          width: "64px",  numeric: true   },
  { key: "bodega",       label: "Bodega",               placeholder: "021",           width: "64px"  },
];

const REQUIRED_KEYS  = COLS.filter(c => c.required).map(c => c.key);
const REQUIRED_LABELS = Object.fromEntries(COLS.filter(c => c.required).map(c => [c.key, c.label.replace(" (NIT)", "")]));

const EMPTY_ROW = () => ({
  id: crypto.randomUUID(),
  entrega:"", destinatario:"", nombre:"", lugar:"",
  material:"", cantidad:"", um:"BUL", item:"1001", bodega:"021",
});

const useIsMobile = () => {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
};

// ── Popup de confirmación ──
function SuccessPopup({ visible, meta, onClose, onNewRequest }) {
  if (!visible) return null;
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:2000,
      background:"rgba(10,30,24,0.6)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:"16px", backdropFilter:"blur(3px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:20, width:"100%", maxWidth:440,
        overflow:"hidden", boxShadow:"0 28px 70px rgba(0,0,0,0.22)",
        animation:"popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {/* Header compacto */}
        <div style={{
          background:"#0F6E56",
          padding:"22px 28px 20px",
          textAlign:"center",
        }}>
          <div style={{
            fontSize:11, color:"rgba(255,255,255,0.65)",
            fontWeight:600, letterSpacing:"0.1em",
            textTransform:"uppercase", marginBottom:10,
            textAlign:"right",
          }}>
            Logistics and Services
          </div>
          <div style={{
            fontSize:13, color:"rgba(255,255,255,0.85)",
            lineHeight:1.5, marginBottom:6,
          }}>
            Hemos recibido correctamente tu solicitud
          </div>
          <div style={{
            display:"inline-block",
            background:"rgba(255,255,255,0.15)",
            borderRadius:8, padding:"6px 18px",
          }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginRight:6 }}>N°</span>
            <span style={{ fontSize:18, color:"#fff", fontWeight:700, letterSpacing:"0.04em" }}>
              {meta.solicitud}
            </span>
          </div>
        </div>

        {/* Cuerpo centrado */}
        <div style={{ padding:"20px 28px 6px" }}>
          {[
            { label:"Área solicitante", value: meta.area      || "—" },
            { label:"Fecha",            value: meta.fecha             },
            { label:"N° Solicitud",     value: meta.solicitud         },
            { label:"Solicitante",      value: meta.solicitante || "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{
              textAlign:"center",
              padding:"10px 0",
              borderBottom:"1px solid #F0F7F4",
            }}>
              <div style={{ fontSize:10, color:"#9CB8AE", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>
                {label}
              </div>
              <div style={{ fontSize:14, color:"#1a2e27", fontWeight:600 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding:"16px 28px 22px", textAlign:"center" }}>
          <div style={{ fontSize:11, color:"#9CB8AE", marginBottom:14 }}>
            El archivo .xlsx fue descargado en tu equipo
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onNewRequest} style={{
              flex:1, height:44, borderRadius:10,
              background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4",
              fontSize:13, fontWeight:600, cursor:"pointer",
              letterSpacing:"-0.01em",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#E1F5EE"}
            onMouseLeave={e => e.currentTarget.style.background = "#F2F8F5"}
            >
              Nueva solicitud
            </button>
            <button onClick={onClose} style={{
              flex:1, height:44, borderRadius:10,
              background:"#0F6E56", color:"#fff", border:"none",
              fontSize:14, fontWeight:600, cursor:"pointer",
              letterSpacing:"-0.01em",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#085041"}
            onMouseLeave={e => e.currentTarget.style.background = "#0F6E56"}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── Bloque de errores detallado ──
function ErrorBlock({ rows, errors }) {
  const byRow = {};
  rows.forEach((row, idx) => {
    const label = `Fila ${idx + 1}`;
    const isDup = errors[`${row.id}-entrega`] && errors[`${row.id}-material`]
      && row.entrega.trim() && row.material.trim();
    const faltantes = REQUIRED_KEYS.filter(k => errors[`${row.id}-${k}`] && !String(row[k]||"").trim())
      .map(k => REQUIRED_LABELS[k]);
    if (isDup || faltantes.length > 0) {
      byRow[label] = { duplicado: !!isDup, faltantes };
    }
  });
  const entries = Object.entries(byRow);
  if (entries.length === 0) return null;
  return (
    <div style={{ background:"#FFF5F5", border:"1px solid #F5A0A0", borderRadius:10, padding:"12px 16px", marginBottom:14 }}>
      <div style={{ fontSize:12, fontWeight:600, color:"#C0392B", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.5" stroke="#C0392B"/>
          <path d="M7 4v3.5M7 10h.01" stroke="#C0392B" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        Errores en las líneas de despacho
      </div>
      {entries.map(([rowLabel, info]) => (
        <div key={rowLabel} style={{ fontSize:12, color:"#7B2020", marginBottom:4, paddingLeft:4 }}>
          <span style={{ fontWeight:600 }}>{rowLabel}</span>
          {info.duplicado && (
            <span> — <span style={{ fontWeight:600, color:"#9B1C1C" }}>Registro duplicado:</span> la combinación Entrega + Material ya existe en otra línea</span>
          )}
          {info.faltantes.length > 0 && (
            <span style={{ color:"#9B4545" }}>{info.duplicado ? " · " : " — "}Campos requeridos: <span style={{ fontWeight:500 }}>{info.faltantes.join(", ")}</span></span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Mobile card ──
function MobileRowCard({ row, idx, errors, onUpdate, onDelete, onDuplicate }) {
  const [open, setOpen] = useState(idx === 0);
  const hasErr = REQUIRED_KEYS.some(k => errors[`${row.id}-${k}`]);
  const summary = [row.entrega, row.material, row.cantidad ? `×${row.cantidad}` : ""].filter(Boolean).join(" · ") || "Fila vacía";

  const handleChange = (key, val) => {
    const v = key === "cantidad" || key === "item" ? val : up(val);
    onUpdate(row.id, key, v);
    if (key === "destinatario") {
      const found = BD_CLIENTES[v.trim()];
      if (found) {
        onUpdate(row.id, "nombre", found.nombre);
        onUpdate(row.id, "lugar", found.ciudad);
      } else {
        const wasFromBD = Object.values(BD_CLIENTES).some(e => e.nombre === row.nombre);
        if (wasFromBD) { onUpdate(row.id, "nombre", ""); onUpdate(row.id, "lugar", ""); }
      }
    }
  };

  const tryAutocomplete = (currentNit) => {
    const nit = (currentNit !== undefined ? currentNit : row.destinatario).trim();
    const found = BD_CLIENTES[nit];
    if (found) {
      onUpdate(row.id, "nombre", found.nombre);
      onUpdate(row.id, "lugar", found.ciudad);
    } else {
      const wasFromBD = Object.values(BD_CLIENTES).some(e => e.nombre === row.nombre);
      if (wasFromBD) { onUpdate(row.id, "nombre", ""); onUpdate(row.id, "lugar", ""); }
    }
  };

  return (
    <div style={{ border:`1px solid ${hasErr ? "#F5A0A0" : "#E2EDE9"}`, borderRadius:12, marginBottom:8, overflow:"hidden", background:"#fff" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer", background:open?"#F2F8F5":"#fff", userSelect:"none" }}>
        <span style={{ minWidth:22, height:22, borderRadius:6, background:"#E1F5EE", color:"#0F6E56", fontSize:11, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center" }}>{idx+1}</span>
        <span style={{ flex:1, fontSize:13, color:"#1a2e27", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{summary}</span>
        {hasErr && <span style={{ fontSize:11, color:"#C0392B", background:"#FFF0EE", padding:"2px 7px", borderRadius:8 }}>incompleto</span>}
        <span style={{ fontSize:16, color:"#9CB8AE", display:"inline-block", transform:open?"rotate(180deg)":"none", transition:"transform 0.2s" }}>⌄</span>
      </div>
      {open && (
        <div style={{ padding:"12px 14px 14px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {COLS.map(c => {
              const hasError = errors[`${row.id}-${c.key}`];
              return (
                <div key={c.key} style={{ gridColumn: c.key==="nombre"?"span 2":"span 1" }}>
                  <label style={{ fontSize:11, color:"#6B8F80", display:"block", marginBottom:4, fontWeight:500 }}>
                    {c.label}{c.required && <span style={{ color:"#C0392B" }}> *</span>}
                  </label>
                  <input
                    type={c.numeric?"number":"text"}
                    value={row[c.key]}
                    placeholder={c.placeholder}
                    onChange={e => handleChange(c.key, e.target.value)}
                    onFocus={e => {
                      if (c.key === "destinatario") tryAutocomplete(row.destinatario);
                      e.target.style.borderColor="#0F6E56";
                      e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.1)";
                    }}
                    onBlur={e => {
                      if (c.key === "destinatario") tryAutocomplete(e.target.value);
                      e.target.style.borderColor = hasError ? "#E74C3C" : "#D4E5DE";
                      e.target.style.boxShadow = "none";
                    }}
                    onKeyDown={e => {
                      if ((e.key === "Tab" || e.key === "Enter") && c.key === "destinatario") {
                        tryAutocomplete(e.target.value);
                      }
                    }}
                    style={{
                      width:"100%", height:40, padding:"0 10px",
                      fontSize:14, border:`1px solid ${hasError?"#E74C3C":"#D4E5DE"}`,
                      borderRadius:8, background:hasError?"#FFF5F5":"#fff",
                      color:"#1a2e27", outline:"none", boxSizing:"border-box",
                      WebkitAppearance:"none", textTransform:c.numeric?"none":"uppercase",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={() => onDuplicate(row.id)} style={{ flex:1, height:36, border:"1px solid #D4E5DE", borderRadius:8, background:"#fff", color:"#0F6E56", fontSize:13, cursor:"pointer" }}>Duplicar</button>
            <button onClick={() => onDelete(row.id)} style={{ flex:1, height:36, border:"1px solid #F5C6C0", borderRadius:8, background:"#FFF5F5", color:"#C0392B", fontSize:13, cursor:"pointer" }}>Eliminar</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════
// ── Componente nuevo: Excel desde PDF (con homologación BD) ──
// ══════════════════════════════════════════════════════════════
function PdfToExcel({ meta, showToast }) {
  const [pdfRows, setPdfRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pdfPopup, setPdfPopup] = useState(false);
  const [pdfMeta, setPdfMeta] = useState({ solicitud:"", fecha:"", area:"", solicitante:"" });
  const [rowErrors, setRowErrors] = useState({});
  const [solicitudYaGenerada, setSolicitudYaGenerada] = useState(false);
  const pdfInputRef = useRef(null);
  const isMobileLocal = typeof window !== "undefined" && window.innerWidth < 768;

  // Columnas del Excel de salida (igual que el formulario principal)
  const OUTPUT_HEADERS = ["Entrega", "Destinat.", "Nombre destinatario de mercancías", "Lugar-destinatario", "Material", "Cantidad entrega", "UM", "item", "bodega"];

  // ── Parser del PDF ──
  const parsePdfText = (fullText) => {
    const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);

    // ── Número de pedido (ej: "# Click0012647")
    const pedidoMatch = fullText.match(/#\s*([A-Za-z0-9]+)/);
    const numeroPedido = pedidoMatch ? pedidoMatch[1].trim() : "";

    // ── Destinatario: línea inmediata después de "Dirigido a"
    const dirigidoIdx = lines.findIndex(l => /^dirigido a$/i.test(l));
    const nombreDestinatario = dirigidoIdx !== -1 && lines[dirigidoIdx + 1]
      ? lines[dirigidoIdx + 1].trim()
      : "";

    // ── Buscar en BD por nombrecliente usando el "Dirigido a" del PDF
    // Si no existe en la BD → NIT y ciudad quedan vacíos, el usuario los edita
    const bdMatch = buscarPorNombre(nombreDestinatario);
    const destinatarioNit    = bdMatch ? bdMatch[0] : "";
    const destinatarioNombre = nombreDestinatario;
    const destinatarioCiudad = bdMatch ? bdMatch[1].ciudad : "";

    // ── Localizar inicio de tabla
    // pdf.js extrae cada encabezado en línea propia: "Sku", "Producto", "Cantidad"...
    // Buscamos la línea "Sku" sola, luego saltamos los demás encabezados
    const skuHeaderIdx = lines.findIndex(l => /^sku$/i.test(l));
    let startIdx = skuHeaderIdx !== -1 ? skuHeaderIdx + 1 : 0;
    // Saltar columnas de encabezado restantes
    const headerCols = ["producto", "cantidad", "precio", "sub total", "total"];
    while (startIdx < lines.length && headerCols.includes(lines[startIdx].toLowerCase())) {
      startIdx++;
    }

    const STOP = ["subtotal", "total", "generado por", "términos", "política", "click cosmetics", "despacha"];

    // ── Patrones de detección
    // SKU normal:  "PTC6700-2025", "PTC", "PTC4400-2025"  — sin espacios
    const SKU_RE = /^[A-Z][A-Z0-9\-]*$|^[A-Z]{2,}$/;
    // SKU partido: "PTC8200 -"  — el PDF parte el SKU en dos líneas cuando hay un espacio
    //              La siguiente línea contiene la continuación (ej: "2026")
    //              Se reconstituye como "PTC8200-2026"
    const BROKEN_SKU_RE = /^([A-Z][A-Z0-9]+)\s*-\s*$/;
    // Cantidad colombiana: 16,00 / 15,00 / 240,00
    const CANT_RE = /^\d{1,4}[,.]\d{2}$/;

    // Helper: ¿es esta línea el inicio de un nuevo SKU (normal o partido)?
    const isSku = (line) => SKU_RE.test(line) || BROKEN_SKU_RE.test(line);

    const parsed = [];
    let i = startIdx;

    while (i < lines.length) {
      const line = lines[i];

      // Parar al llegar al pie de la tabla
      if (STOP.some(sw => line.toLowerCase().startsWith(sw))) break;

      // ── Caso 1: SKU partido en dos líneas ("PTC8200 -" + "2026")
      const brokenMatch = BROKEN_SKU_RE.exec(line);
      if (brokenMatch) {
        const part1    = brokenMatch[1];                              // "PTC8200"
        const part2    = (i + 1 < lines.length) ? lines[i + 1].trim() : "";  // "2026"
        const sku      = `${part1}-${part2}`;                        // "PTC8200-2026"
        const producto = (i + 2 < lines.length) ? lines[i + 2] : "";
        let cantidad = 0;
        for (let k = i + 3; k < Math.min(i + 8, lines.length); k++) {
          if (CANT_RE.test(lines[k])) { cantidad = parseFloat(lines[k].replace(",", ".")); break; }
        }
        parsed.push({
          entrega: numeroPedido, destinatario: destinatarioNit,
          nombre: destinatarioNombre, lugar: destinatarioCiudad,
          material: sku, cantidad: cantidad || "",
          um: "BUL", item: "1001", bodega: "021",
        });
        // Avanzar al próximo SKU
        i += 2; // skip part2 line, then continue scanning
        while (i < lines.length) {
          if (STOP.some(sw => lines[i].toLowerCase().startsWith(sw))) break;
          if (isSku(lines[i])) break;
          i++;
        }
        continue;
      }

      // ── Caso 2: SKU normal ("PTC6700-2025", "PTC", etc.)
      if (!SKU_RE.test(line)) { i++; continue; }

      const sku      = line;
      const producto = (i + 1 < lines.length) ? lines[i + 1] : "";
      let cantidad = 0;
      for (let k = i + 2; k < Math.min(i + 8, lines.length); k++) {
        if (CANT_RE.test(lines[k])) { cantidad = parseFloat(lines[k].replace(",", ".")); break; }
      }
      parsed.push({
        entrega: numeroPedido, destinatario: destinatarioNit,
        nombre: destinatarioNombre, lugar: destinatarioCiudad,
        material: sku, cantidad: cantidad || "",
        um: "BUL", item: "1001", bodega: "021",
      });

      // Avanzar al próximo SKU
      i++;
      while (i < lines.length) {
        if (STOP.some(sw => lines[i].toLowerCase().startsWith(sw))) break;
        if (isSku(lines[i])) break;
        i++;
      }
    }

    return { filas: parsed, numeroPedido, nombreDestinatario, bdMatch };
  };

  const processPdf = async (file) => {
    if (!file || file.type !== "application/pdf") {
      setError("Solo se aceptan archivos PDF.");
      return;
    }
    setLoading(true);
    setError("");
    setPdfRows([]);
    setFileName(file.name);

    try {
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve;
          script.onerror = () => reject(new Error("No se pudo cargar pdf.js"));
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        // Usar cada item como línea propia — preserva el orden del stream del PDF
        // (agrupar por Y no funciona porque esta familia de PDFs pone todos los
        //  items de la tabla en el mismo valor Y, colapsándolos en una sola línea)
        for (const item of content.items) {
          const t = (item.str || "").trim();
          if (t) fullText += t + "\n";
        }
      }

      const { filas, numeroPedido, nombreDestinatario, bdMatch } = parsePdfText(fullText);

      if (filas.length === 0) {
        setError("Se leyó el PDF pero no se encontraron filas de productos. Verifica que el PDF tenga texto seleccionable con columnas Sku, Producto, Cantidad.");
      } else {
        // Siempre cargar las filas — con o sin match en BD
        setPdfRows(filas);
        // Aviso: si no hubo match en BD (ni por nombre ni por dominio email)
        if (!bdMatch && nombreDestinatario) {
          setError(`⚠ "${nombreDestinatario}" no se encontró en la BD de clientes. NIT y ciudad quedan en blanco — puedes editarlos en la tabla antes de descargar.`);
        } else {
          setError("");
        }
      }
    } catch (err) {
      setError("Error al procesar el PDF: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processPdf(file);
  };

  const updatePdfRow = (idx, key, val) => {
    setPdfRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  };

  const exportPdfToExcel = () => {
    if (pdfRows.length === 0) return;

    // ── Bloquear si ya se generó una solicitud con este mismo PDF sin haber limpiado
    if (solicitudYaGenerada) {
      if (showToast) showToast(
        `⚠ Está intentando generar una solicitud con los datos de la solicitud que continúan en pantalla: ${fileName}`
      );
      setPdfPopup(true);
      return;
    }

    // ── Validar campos de cabecera (Área, Solicitante, Correo)
    const metaErrs = {};
    if (!meta.area.trim())        metaErrs["pdf-area"] = true;
    if (!meta.solicitante.trim()) metaErrs["pdf-solicitante"] = true;
    const correoTrimmed = meta.correo ? meta.correo.trim() : "";
    if (!correoTrimmed || !correoTrimmed.includes("@")) metaErrs["pdf-correo"] = true;

    // ── Validar campos obligatorios de cada fila: destinatario, nombre, lugar
    const rErrs = {};
    pdfRows.forEach((r, idx) => {
      if (!String(r.destinatario || "").trim()) rErrs[`${idx}-destinatario`] = true;
      if (!String(r.nombre || "").trim())       rErrs[`${idx}-nombre`] = true;
      if (!String(r.lugar || "").trim())         rErrs[`${idx}-lugar`] = true;
    });

    if (Object.keys(metaErrs).length > 0 || Object.keys(rErrs).length > 0) {
      setRowErrors(rErrs);
      const msgs = [];
      if (metaErrs["pdf-area"])        msgs.push("Área solicitante");
      if (metaErrs["pdf-solicitante"]) msgs.push("Solicitante");
      if (metaErrs["pdf-correo"])      msgs.push("Correo electrónico");
      const filasFaltantes = [...new Set(
        Object.keys(rErrs).map(k => `Fila ${parseInt(k)+1}`)
      )];
      if (filasFaltantes.length > 0) msgs.push(`${filasFaltantes.join(", ")}: NIT, Nombre o Ciudad vacíos`);
      if (showToast) showToast("⚠ Completa: " + msgs.join(" · "));
      return;
    }

    setRowErrors({});

    // ── Generar número de solicitud y fecha final
    const solicitudFinal = generateSolicitud();
    const fechaFinal = generateFecha();
    const metaFinal = { solicitud: solicitudFinal, fecha: fechaFinal, area: meta.area, solicitante: meta.solicitante };
    setPdfMeta(metaFinal);

    const wb = XLSX.utils.book_new();
    const dataRows = pdfRows.map(r => [
      r.entrega, r.destinatario, r.nombre, r.lugar,
      r.material, parseFloat(r.cantidad) || 0,
      r.um, r.item, r.bodega
    ]);
    const ws = XLSX.utils.aoa_to_sheet([OUTPUT_HEADERS, ...dataRows]);
    ws["!cols"] = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    const safeName = fileName.replace(/\.pdf$/i, "");
    XLSX.writeFile(wb, `despacho_${(meta.area||"pdf").replace(/\s+/g,"_")}_${solicitudFinal}.xlsx`);
    setSolicitudYaGenerada(true);
    setPdfPopup(true);
  };

  const resetPdf = () => {
    setPdfRows([]); setFileName(""); setError(""); setRowErrors({}); setPdfPopup(false); setSolicitudYaGenerada(false);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  // Columnas visibles en la preview (mismas que el formulario)
  const PREVIEW_COLS = [
    { key:"entrega",      label:"Entrega",        w:"110px" },
    { key:"destinatario", label:"NIT",             w:"100px" },
    { key:"nombre",       label:"Nombre dest.",    w:"180px" },
    { key:"lugar",        label:"Ciudad",          w:"100px" },
    { key:"material",     label:"Material (SKU)",  w:"110px" },
    { key:"cantidad",     label:"Cantidad",        w:"80px", numeric:true },
    { key:"um",           label:"UM",              w:"54px" },
    { key:"item",         label:"Ítem",            w:"64px" },
    { key:"bodega",       label:"Bodega",          w:"64px" },
  ];

  return (
    <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", overflow:"hidden", marginBottom:14 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid #E2EDE9" }}>
        <span style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em" }}>
          Excel desde PDF
        </span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {pdfRows.length > 0 && (
            <span style={{ fontSize:12, color:"#0F6E56", background:"#E1F5EE", padding:"3px 10px", borderRadius:20, fontWeight:500 }}>
              {pdfRows.length} línea{pdfRows.length !== 1 ? "s" : ""}
            </span>
          )}
          <span style={{ fontSize:11, color:"#0F6E56", background:"#E1F5EE", padding:"3px 10px", borderRadius:20, fontWeight:500 }}>nueva función</span>
        </div>
      </div>

      <div style={{ padding: isMobileLocal ? "14px 12px" : "16px 20px" }}>
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => pdfInputRef.current?.click()}
          style={{
            border:`1.5px dashed ${dragOver ? "#0F6E56" : "#C5DDD4"}`,
            borderRadius:10, padding:"20px 16px", textAlign:"center",
            background: dragOver ? "#F0FBF6" : "#F7FCF9",
            cursor:"pointer", marginBottom:14, transition:"border-color 0.2s, background 0.2s",
          }}
        >
          <input ref={pdfInputRef} type="file" accept="application/pdf" style={{ display:"none" }}
            onChange={(e) => { if (e.target.files[0]) processPdf(e.target.files[0]); }} />
          <div style={{ width:36, height:36, background:"#E1F5EE", borderRadius:8, margin:"0 auto 10px", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 3h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M10 3v5h5" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M6 10h6M6 13h4" stroke="#0F6E56" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          {loading ? (
            <div style={{ fontSize:13, color:"#0F6E56", fontWeight:500 }}>Leyendo PDF y buscando en BD…</div>
          ) : fileName && pdfRows.length > 0 ? (
            <>
              <div style={{ fontSize:13, fontWeight:600, color:"#1a2e27", marginBottom:2 }}>{fileName}</div>
              <div style={{ fontSize:11, color:"#6B8F80" }}>{pdfRows.length} líneas generadas · haz clic para cambiar</div>
            </>
          ) : (
            <>
              <div style={{ fontSize:13, fontWeight:500, color:"#1a2e27", marginBottom:4 }}>Arrastra tu PDF de pedido aquí</div>
              <div style={{ fontSize:11, color:"#6B8F80", marginBottom:12 }}>
                Lee el PDF · busca el cliente en BD · genera el Excel de despacho
              </div>
              <div style={{ display:"inline-block", padding:"7px 18px", background:"#0F6E56", color:"#fff", borderRadius:8, fontSize:12, fontWeight:500 }}>
                Seleccionar PDF
              </div>
            </>
          )}
        </div>

        {/* Aviso / error */}
        {error && (
          <div style={{
            background: error.startsWith("⚠") ? "#FFFBEB" : "#FFF5F5",
            border: `1px solid ${error.startsWith("⚠") ? "#F6D860" : "#F5A0A0"}`,
            borderRadius:10, padding:"10px 14px", marginBottom:14,
            fontSize:12, color: error.startsWith("⚠") ? "#92600A" : "#C0392B", lineHeight:1.5,
          }}>
            {error}
          </div>
        )}

        {/* Preview tabla editable */}
        {pdfRows.length > 0 && (
          <>
            <div style={{ overflowX:"auto", marginBottom:14, borderRadius:8, border:"1px solid #E2EDE9" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860, fontSize:12 }}>
                <thead>
                  <tr style={{ background:"#F2F8F5" }}>
                    <th style={{ width:32, padding:"8px 6px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:"center", borderBottom:"1px solid #E2EDE9" }}>#</th>
                    {PREVIEW_COLS.map(c => (
                      <th key={c.key} style={{ width:c.w, padding:"8px 8px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:c.numeric?"right":"left", borderBottom:"1px solid #E2EDE9", whiteSpace:"nowrap" }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pdfRows.map((r, idx) => (
                    <tr key={idx} style={{ borderBottom:"1px solid #F0F7F4" }}
                      onMouseEnter={e => e.currentTarget.style.background="#FAFCFB"}
                      onMouseLeave={e => e.currentTarget.style.background=""}
                    >
                      <td style={{ textAlign:"center", fontSize:11, color:"#9CB8AE", padding:"3px 4px" }}>{idx+1}</td>
                      {PREVIEW_COLS.map(c => {
                        const hasErr = rowErrors[`${idx}-${c.key}`];
                        return (
                          <td key={c.key} style={{ padding:"3px" }}>
                            <input
                              type={c.numeric ? "number" : "text"}
                              value={r[c.key]}
                              onChange={e => {
                                updatePdfRow(idx, c.key, e.target.value);
                                if (hasErr) setRowErrors(prev => { const n={...prev}; delete n[`${idx}-${c.key}`]; return n; });
                              }}
                              style={{
                                width:"100%", height:30, padding:"0 7px", fontSize:12,
                                border: hasErr ? "1px solid #E74C3C" : "1px solid transparent",
                                borderRadius:6,
                                background: hasErr ? "#FFF5F5" : "transparent",
                                color:"#1a2e27", outline:"none",
                                textAlign:c.numeric?"right":"left",
                                boxSizing:"border-box",
                              }}
                              onFocus={e => { e.target.style.background="#F2F8F5"; e.target.style.border="1px solid #0F6E56"; }}
                              onBlur={e => {
                                e.target.style.background = hasErr ? "#FFF5F5" : "transparent";
                                e.target.style.border = hasErr ? "1px solid #E74C3C" : "1px solid transparent";
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <button onClick={resetPdf}
                style={{ padding:"8px 16px", fontSize:13, border:"1px solid #E2EDE9", borderRadius:9, background:"#fff", color:"#6B8F80", cursor:"pointer" }}
                onMouseEnter={e => { e.currentTarget.style.background="#FFF0EE"; e.currentTarget.style.color="#C0392B"; e.currentTarget.style.borderColor="#F5C6C0"; }}
                onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.color="#6B8F80"; e.currentTarget.style.borderColor="#E2EDE9"; }}
              >Limpiar</button>
              <button onClick={exportPdfToExcel}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 22px", fontSize:13, fontWeight:600, border:"none", borderRadius:9, background:"#0F6E56", color:"#fff", cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.background="#085041"}
                onMouseLeave={e => e.currentTarget.style.background="#0F6E56"}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Descargar Excel
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Popup de confirmación PDF ── */}
      {pdfPopup && (
        <div style={{
          position:"fixed", inset:0, zIndex:2000,
          background:"rgba(10,30,24,0.6)",
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:"16px", backdropFilter:"blur(3px)",
        }}>
          <div style={{
            background:"#fff", borderRadius:20, width:"100%", maxWidth:440,
            overflow:"hidden", boxShadow:"0 28px 70px rgba(0,0,0,0.22)",
            animation:"popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)",
          }}>
            <div style={{ background:"#0F6E56", padding:"22px 28px 20px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, textAlign:"right" }}>
                Logistics and Services
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", lineHeight:1.5, marginBottom:6 }}>
                Excel generado correctamente desde PDF
              </div>
              <div style={{ display:"inline-block", background:"rgba(255,255,255,0.15)", borderRadius:8, padding:"6px 18px" }}>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginRight:6 }}>N°</span>
                <span style={{ fontSize:18, color:"#fff", fontWeight:700, letterSpacing:"0.04em" }}>{pdfMeta.solicitud}</span>
              </div>
            </div>
            <div style={{ padding:"20px 28px 6px" }}>
              {[
                { label:"Área solicitante", value: pdfMeta.area       || "—" },
                { label:"Fecha",            value: pdfMeta.fecha              },
                { label:"N° Solicitud",     value: pdfMeta.solicitud          },
                { label:"Solicitante",      value: pdfMeta.solicitante || "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign:"center", padding:"10px 0", borderBottom:"1px solid #F0F7F4" }}>
                  <div style={{ fontSize:10, color:"#9CB8AE", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:14, color:"#1a2e27", fontWeight:600 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:"16px 28px 22px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#9CB8AE", marginBottom:14 }}>El archivo .xlsx fue descargado en tu equipo</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={resetPdf} style={{ flex:1, height:44, borderRadius:10, background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:13, fontWeight:600, cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background="#E1F5EE"}
                  onMouseLeave={e => e.currentTarget.style.background="#F2F8F5"}
                >Nuevo PDF</button>
                <button onClick={() => setPdfPopup(false)} style={{ flex:1, height:44, borderRadius:10, background:"#0F6E56", color:"#fff", border:"none", fontSize:14, fontWeight:600, cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background="#085041"}
                  onMouseLeave={e => e.currentTarget.style.background="#0F6E56"}
                >Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App principal ──
export default function App() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState([EMPTY_ROW()]);
  // solicitudFinalizada: true cuando ya se generó y no debe actualizarse más
  const [solicitudFinalizada, setSolicitudFinalizada] = useState(false);
  const [meta, setMeta] = useState({ area:"", fecha:generateFecha(), solicitud:"", solicitante:"", correo:"" });
  const [errors, setErrors] = useState({});
  const [popup, setPopup] = useState(false);
  const [toast, setToast] = useState({ visible:false, message:"" });
  const tableRef = useRef(null);
  const timerRef = useRef(null);

  // Actualiza fecha y solicitud pendiente cada minuto, solo si aún no se finalizó
  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (!solicitudFinalizada) {
        setMeta(p => ({ ...p, fecha:generateFecha() }));
      }
    }, 60000);
    return () => clearInterval(timerRef.current);
  }, [solicitudFinalizada]);

  const showToast = msg => {
    setToast({ visible:true, message:msg });
    setTimeout(() => setToast(t => ({ ...t, visible:false })), 3500);
  };

  const applyClienteSync = (row, nit) => {
    const nitClean = (nit || row.destinatario).trim();
    const found = BD_CLIENTES[nitClean];
    if (found) return { ...row, nombre: found.nombre, lugar: found.ciudad };
    const wasFromBD = Object.values(BD_CLIENTES).some(v => v.nombre === row.nombre);
    return { ...row, nombre: wasFromBD ? "" : row.nombre, lugar: wasFromBD ? "" : row.lugar };
  };

  const syncCliente = (id, nit) => {
    setRows(p => p.map(r => r.id === id ? applyClienteSync(r, nit) : r));
  };

  const syncAllClientes = (currentRows) =>
    currentRows.map(r => applyClienteSync(r, r.destinatario));

  const updateRow = (id, key, value) => {
    setRows(p => p.map(r => r.id === id ? { ...r, [key]:value } : r));
    setErrors(p => { const n = { ...p }; delete n[`${id}-${key}`]; return n; });
  };

  const isDuplicate = (currentId, entrega, material) => {
    if (!entrega.trim() || !material.trim()) return false;
    return rows.some(r =>
      r.id !== currentId &&
      r.entrega.trim().toUpperCase() === entrega.trim().toUpperCase() &&
      r.material.trim().toUpperCase() === material.trim().toUpperCase()
    );
  };

  const handleCellChange = (id, key, rawVal) => {
    const v = key === "cantidad" || key === "item" ? rawVal : up(rawVal);
    updateRow(id, key, v);
    if (key === "destinatario") {
      syncCliente(id, v);
    }
    if (key === "entrega" || key === "material") {
      const row = rows.find(r => r.id === id);
      if (!row) return;
      const entrega  = key === "entrega"   ? v : row.entrega;
      const material = key === "material"  ? v : row.material;
      if (isDuplicate(id, entrega, material)) {
        setErrors(prev => ({ ...prev, [`${id}-entrega`]:true, [`${id}-material`]:true }));
        showToast(`⚠ Ya existe una línea con Entrega "${entrega}" y Material "${material}"`);
      } else {
        setErrors(prev => {
          const n = { ...prev };
          delete n[`${id}-entrega`]; delete n[`${id}-material`];
          return n;
        });
      }
    }
  };

  const handleDestinatarioBlur  = (id, nit) => syncCliente(id, nit);
  const handleDestinatarioFocus = (id, nit) => syncCliente(id, nit);

  const validateRowPure = (row, allRows) => {
    const e = {};
    REQUIRED_KEYS.forEach(k => { if (!String(row[k]||"").trim()) e[`${row.id}-${k}`] = true; });
    const others = allRows.filter(r => r.id !== row.id);
    const isDup = row.entrega.trim() && row.material.trim() && others.some(r =>
      r.entrega.trim().toUpperCase()  === row.entrega.trim().toUpperCase() &&
      r.material.trim().toUpperCase() === row.material.trim().toUpperCase()
    );
    if (isDup) { e[`${row.id}-entrega`] = true; e[`${row.id}-material`] = true; }
    return e;
  };

  const validateRow = (row, allRows) => validateRowPure(row, allRows || rows);

  const validateLastRow = () => {
    const last = rows[rows.length - 1];
    const e = validateRow(last, rows);
    setErrors(prev => ({ ...prev, ...e }));
    if (Object.keys(e).length > 0) {
      const missing = REQUIRED_KEYS.filter(k => e[`${last.id}-${k}`]).map(k => REQUIRED_LABELS[k]);
      if (e[`${last.id}-entrega`] && e[`${last.id}-material`] &&
          last.entrega.trim() && last.material.trim()) {
        showToast(`⚠ Fila ${rows.length}: ya existe Entrega "${last.entrega}" + Material "${last.material}"`);
      } else {
        showToast(`⚠ Fila ${rows.length} incompleta: ${missing.join(", ")}`);
      }
      return false;
    }
    return true;
  };

  const validateAll = () => {
    const e = {};
    rows.forEach(r => Object.assign(e, validateRow(r, rows)));
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const addRow = () => {
    const syncedRows = rows.map((r, i) =>
      i === rows.length - 1 ? applyClienteSync(r, r.destinatario) : r
    );
    setRows(syncedRows);
    const last = syncedRows[syncedRows.length - 1];
    const e = validateRowPure(last, syncedRows);
    if (Object.keys(e).length > 0) {
      setErrors(prev => ({ ...prev, ...e }));
      const missing = REQUIRED_KEYS.filter(k => e[`${last.id}-${k}`] && !String(last[k]||"").trim()).map(k => REQUIRED_LABELS[k]);
      const isDupErr = e[`${last.id}-entrega`] && e[`${last.id}-material`] && last.entrega.trim() && last.material.trim();
      if (isDupErr) showToast(`⚠ Fila ${rows.length}: duplicado Entrega "${last.entrega}" + Material "${last.material}"`);
      else showToast(`⚠ Fila ${rows.length} incompleta: ${missing.join(", ")}`);
      return;
    }
    setRows(p => [...p, EMPTY_ROW()]);
    setTimeout(() => {
      if (isMobile) return;
      tableRef.current?.querySelectorAll("tbody tr:last-child input")?.[0]?.focus();
    }, 60);
  };

  const deleteRow = id => {
    setRows(p => p.length > 1 ? p.filter(r => r.id !== id) : [EMPTY_ROW()]);
    setErrors(prev => {
      const n = { ...prev };
      Object.keys(n).forEach(k => { if (k.startsWith(id)) delete n[k]; });
      return n;
    });
  };

  const duplicateRow = id => {
    const src = rows.find(r => r.id === id);
    if (!src) return;
    const newId = crypto.randomUUID();
    const nr = { ...src, id: newId, material: "" };
    setRows(p => {
      const i = p.findIndex(r => r.id === id);
      const a = [...p];
      a.splice(i + 1, 0, nr);
      return a;
    });
    setTimeout(() => {
      if (!tableRef.current) return;
      const trs = tableRef.current.querySelectorAll("tbody tr");
      for (const tr of trs) {
        const inputs = tr.querySelectorAll("input");
        if (inputs[4] && inputs[4].value === "") {
          inputs[4].focus();
          break;
        }
      }
    }, 60);
  };

  // Nueva solicitud: limpia todo y genera nueva fecha/solicitud pendiente
  const newRequest = () => {
    setRows([EMPTY_ROW()]);
    setMeta({ area:"", fecha:generateFecha(), solicitud:"", solicitante:"", correo:"" });
    setErrors({});
    setSolicitudFinalizada(false);
    setPopup(false);
  };

  const clearAll = () => {
    const hasData = rows.some(r => REQUIRED_KEYS.some(k => r[k]));
    if (hasData && !window.confirm("¿Limpiar todo?")) return;
    setRows([EMPTY_ROW()]);
    setMeta(p => ({ ...p, area:"", solicitante:"", correo:"" }));
    setErrors({});
    setSolicitudFinalizada(false);
  };

  const exportExcel = useCallback(() => {
    const syncedRows = syncAllClientes(rows);
    setRows(syncedRows);

    // Validar campos de cabecera obligatorios
    const metaErrors = {};
    if (!meta.area.trim())        metaErrors["meta-area"] = true;
    if (!meta.solicitante.trim()) metaErrors["meta-solicitante"] = true;
    const correoTrimmed = meta.correo.trim();
    if (!correoTrimmed) {
      metaErrors["meta-correo"] = true;
    } else if (!correoTrimmed.includes("@")) {
      metaErrors["meta-correo"] = true;
    }

    if (Object.keys(metaErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...metaErrors }));
      const missing = [
        !meta.area.trim() && "Área solicitante",
        !meta.solicitante.trim() && "Solicitante",
        (!correoTrimmed || !correoTrimmed.includes("@")) && "Correo electrónico válido",
      ].filter(Boolean);
      showToast(`⚠ Información del envío: completa ${missing.join(", ")}`);
      return;
    }

    const rowErrors = {};
    syncedRows.forEach(r => Object.assign(rowErrors, validateRowPure(r, syncedRows)));
    if (Object.keys(rowErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...rowErrors }));
      showToast("⚠ Revisa los campos marcados en rojo");
      return;
    }

    // Generar número de solicitud definitivo solo al momento de descargar
    const solicitudFinal = generateSolicitud();
    const fechaFinal = generateFecha();
    const metaFinal = { ...meta, solicitud: solicitudFinal, fecha: fechaFinal };
    setMeta(metaFinal);
    setSolicitudFinalizada(true); // congela la fecha y solicitud

    const wb = XLSX.utils.book_new();
    const headers = ["Entrega","Destinat.","Nombre destinatario de mercancías","Lugar-destinatario","Material","Cantidad entrega","UM","item","bodega"];
    const dataRows = syncedRows.map(r => [r.entrega, r.destinatario, r.nombre, r.lugar, r.material, parseFloat(r.cantidad)||0, r.um, parseInt(r.item)||0, r.bodega]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    const fname = `despacho_${(meta.area||"envio").replace(/\s+/g,"_")}_${solicitudFinal}.xlsx`;
    XLSX.writeFile(wb, fname);
    setPopup(true);
  }, [rows, meta]);

  // Descargar manual
  const downloadManual = () => {
    const link = document.createElement("a");
    link.href = "/manual_portal_despachos.html";
    link.download = "Manual_Portal_Despachos_Logistics_and_Services.html";
    link.click();
  };

  const filledRows = rows.filter(r => r.entrega || r.material || r.destinatario).length;

  const inputBase = {
    width:"100%", height:38, padding:"0 10px", fontSize:14,
    border:"1px solid #D4E5DE", borderRadius:8,
    background:"#fff", color:"#1a2e27", outline:"none",
    boxSizing:"border-box", WebkitAppearance:"none",
  };
  const inputReadonly = {
    ...inputBase,
    background:"#F2F8F5", color:"#5A7A6E",
    border:"1px solid #E2EDE9", cursor:"default", fontWeight:500,
  };

  return (
    <div style={{ minHeight:"100vh", background:"#F7F9F8", fontFamily:"'DM Sans','Helvetica Neue',sans-serif", paddingBottom:60 }}>

      {/* Header */}
      <div style={{ background:"#fff", borderBottom:"1px solid #E2EDE9", padding:"0 16px", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ maxWidth:1140, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:56 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"#0F6E56", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="3" width="14" height="2" rx="1" fill="white"/>
                <rect x="2" y="8" width="14" height="2" rx="1" fill="white"/>
                <rect x="2" y="13" width="9" height="2" rx="1" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize:isMobile?14:15, fontWeight:600, color:"#0F6E56", lineHeight:1.2 }}>Logistics and Services</div>
              {!isMobile && <div style={{ fontSize:11, color:"#6B8F80" }}>Portal de ingreso de despachos</div>}
            </div>
          </div>

          {/* Right side: lines counter + manual button */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {filledRows > 0 && (
              <span style={{ fontSize:12, color:"#0F6E56", background:"#E1F5EE", padding:"4px 10px", borderRadius:20, fontWeight:500 }}>
                {filledRows} línea{filledRows!==1?"s":""}
              </span>
            )}
            <button
              onClick={downloadManual}
              title="Descargar manual de usuario"
              style={{
                display:"flex", alignItems:"center", gap:6,
                padding:"6px 14px", fontSize:12, fontWeight:600,
                border:"1px solid #D4E5DE", borderRadius:8,
                background:"#fff", color:"#0F6E56", cursor:"pointer",
                transition:"all 0.2s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background="#F2F8F5"; e.currentTarget.style.borderColor="#0F6E56"; }}
              onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.borderColor="#D4E5DE"; }}
            >
              {/* Book icon */}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 2h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H3V2z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M13 2H8.5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5H13V2z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M8 4v7" stroke="#0F6E56" strokeWidth="1" strokeLinecap="round"/>
              </svg>
              {!isMobile && "Manual"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1140, margin:"0 auto", padding:isMobile?"16px 12px 0":"24px 24px 0" }}>

        {/* Meta */}
        <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", padding:isMobile?"14px":"18px 22px", marginBottom:16 }}>
          <div style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>Información del envío</div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"2fr 1.2fr 0.9fr 2fr 2fr", gap:12 }}>

            {/* Área solicitante */}
            <div>
              <label style={{ fontSize:12, color:errors["meta-area"]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Área solicitante *</label>
              <input type="text" value={meta.area}
                onChange={e => { setMeta(p => ({ ...p, area:up(e.target.value) })); setErrors(p => { const n={...p}; delete n["meta-area"]; return n; }); }}
                placeholder="ÁREA"
                style={{ ...inputBase, textTransform:"uppercase", border:errors["meta-area"]?"1px solid #E74C3C":"1px solid #D4E5DE", background:errors["meta-area"]?"#FFF5F5":"#fff" }}
                onFocus={e => { e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)"; e.target.style.background="#fff"; }}
                onBlur={e => { e.target.style.borderColor=errors["meta-area"]?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
              />
            </div>

            {/* Fecha */}
            <div>
              <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>
                Fecha <span style={{ fontSize:10, color:"#9CB8AE" }}>automática</span>
              </label>
              <input type="text" value={meta.fecha} readOnly style={inputReadonly} />
            </div>

            {/* N° Solicitud — compacto */}
            <div>
              <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>
                N° Solicitud
              </label>
              <input type="text" value={meta.solicitud || "—"} readOnly style={{ ...inputReadonly, letterSpacing:"0.02em" }} />
            </div>

            {/* Solicitante */}
            <div>
              <label style={{ fontSize:12, color:errors["meta-solicitante"]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Solicitante *</label>
              <input type="text" value={meta.solicitante}
                onChange={e => { setMeta(p => ({ ...p, solicitante:up(e.target.value) })); setErrors(p => { const n={...p}; delete n["meta-solicitante"]; return n; }); }}
                placeholder="NOMBRE SOLICITANTE"
                style={{ ...inputBase, textTransform:"uppercase", border:errors["meta-solicitante"]?"1px solid #E74C3C":"1px solid #D4E5DE", background:errors["meta-solicitante"]?"#FFF5F5":"#fff" }}
                onFocus={e => { e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)"; e.target.style.background="#fff"; }}
                onBlur={e => { e.target.style.borderColor=errors["meta-solicitante"]?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
              />
            </div>

            {/* Correo electrónico */}
            <div>
              <label style={{ fontSize:12, color:errors["meta-correo"]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Correo electrónico *</label>
              <input
                type="email"
                value={meta.correo}
                onChange={e => {
                  // Remove spaces automatically
                  const val = e.target.value.replace(/\s/g, "");
                  setMeta(p => ({ ...p, correo: val }));
                  setErrors(p => { const n={...p}; delete n["meta-correo"]; return n; });
                }}
                placeholder="correo@empresa.com"
                style={{ ...inputBase, border:errors["meta-correo"]?"1px solid #E74C3C":"1px solid #D4E5DE", background:errors["meta-correo"]?"#FFF5F5":"#fff" }}
                onFocus={e => { e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)"; e.target.style.background="#fff"; }}
                onBlur={e => { e.target.style.borderColor=errors["meta-correo"]?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
              />
            </div>
          </div>
        </div>

        {/* Bloque de errores detallado */}
        <ErrorBlock rows={rows} errors={errors} />

        {/* Lines */}
        <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", overflow:"hidden", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid #E2EDE9" }}>
            <span style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em" }}>Líneas de despacho</span>
            <span style={{ fontSize:12, color:"#6B8F80" }}>{rows.length} fila{rows.length!==1?"s":""}</span>
          </div>

          {/* Desktop table */}
          {!isMobile && (
            <div style={{ overflowX:"auto" }} ref={tableRef}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860 }}>
                <thead>
                  <tr style={{ background:"#F2F8F5" }}>
                    <th style={{ width:34, padding:"8px 6px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:"center", borderBottom:"1px solid #E2EDE9" }}>#</th>
                    {COLS.map(c => (
                      <th key={c.key} style={{ width:c.width, padding:"8px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:c.numeric?"right":"left", borderBottom:"1px solid #E2EDE9", whiteSpace:"nowrap" }}>
                        {c.label}{c.required && <span style={{ color:"#C0392B" }}> *</span>}
                      </th>
                    ))}
                    <th style={{ width:60, borderBottom:"1px solid #E2EDE9" }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.id}
                      style={{ borderBottom:"1px solid #F0F7F4", transition:"background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background="#FAFCFB"}
                      onMouseLeave={e => e.currentTarget.style.background=""}
                    >
                      <td style={{ textAlign:"center", fontSize:11, color:"#9CB8AE", userSelect:"none", padding:"3px 4px" }}>{idx+1}</td>
                      {COLS.map(c => {
                        const hasError = errors[`${row.id}-${c.key}`];
                        return (
                          <td key={c.key} style={{ padding:"3px" }}>
                            <input
                              type={c.numeric?"number":"text"}
                              value={row[c.key]}
                              placeholder={c.placeholder}
                              onChange={e => handleCellChange(row.id, c.key, e.target.value)}
                              onFocus={e => {
                                if (c.key === "destinatario") handleDestinatarioFocus(row.id, row.destinatario);
                                e.target.style.background="#F2F8F5";
                                e.target.style.border="1px solid #0F6E56";
                              }}
                              onBlur={e => {
                                if (c.key === "destinatario") handleDestinatarioBlur(row.id, row.destinatario);
                                e.target.style.background = hasError?"#FFF5F5":"transparent";
                                e.target.style.border = hasError?"1px solid #E74C3C":"1px solid transparent";
                              }}
                              onKeyDown={e => {
                                if ((e.key === "Tab" || e.key === "Enter") && c.key === "destinatario") {
                                  handleDestinatarioBlur(row.id, e.target.value);
                                }
                              }}
                              style={{
                                width:"100%", height:30, padding:"0 7px",
                                fontSize:12,
                                border:hasError?"1px solid #E74C3C":"1px solid transparent",
                                borderRadius:6,
                                background:hasError?"#FFF5F5":"transparent",
                                color:"#1a2e27", outline:"none",
                                textAlign:c.numeric?"right":"left",
                                textTransform:c.numeric?"none":"uppercase",
                                boxSizing:"border-box",
                              }}
                            />
                          </td>
                        );
                      })}
                      <td style={{ padding:"3px 6px" }}>
                        <div style={{ display:"flex", gap:2, justifyContent:"center" }}>
                          {[
                            { label:"⎘", title:"Duplicar", fn:() => duplicateRow(row.id), hover:{ bg:"#E1F5EE", color:"#0F6E56" } },
                            { label:"×", title:"Eliminar",  fn:() => deleteRow(row.id),   hover:{ bg:"#FFF0EE", color:"#C0392B" }, big:true },
                          ].map(btn => (
                            <button key={btn.title} title={btn.title} onClick={btn.fn}
                              style={{ width:26, height:26, border:"none", background:"none", cursor:"pointer", borderRadius:5, color:"#9CB8AE", fontSize:btn.big?16:13, display:"flex", alignItems:"center", justifyContent:"center" }}
                              onMouseEnter={e => { e.currentTarget.style.background=btn.hover.bg; e.currentTarget.style.color=btn.hover.color; }}
                              onMouseLeave={e => { e.currentTarget.style.background="none"; e.currentTarget.style.color="#9CB8AE"; }}
                            >{btn.label}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mobile cards */}
          {isMobile && (
            <div style={{ padding:"12px" }}>
              {rows.map((row, idx) => (
                <MobileRowCard key={row.id} row={row} idx={idx} errors={errors}
                  onUpdate={updateRow} onDelete={deleteRow} onDuplicate={duplicateRow}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:isMobile?"wrap":"nowrap" }}>
          <button onClick={addRow}
            style={{ display:"flex", alignItems:"center", gap:7, padding:isMobile?"10px 16px":"8px 16px", fontSize:13, fontWeight:500, border:"1px solid #D4E5DE", borderRadius:9, background:"#fff", color:"#0F6E56", cursor:"pointer", flex:isMobile?"1 1 auto":"none" }}
            onMouseEnter={e => e.currentTarget.style.background="#F2F8F5"}
            onMouseLeave={e => e.currentTarget.style.background="#fff"}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="#0F6E56" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Agregar línea
          </button>
          <button onClick={clearAll}
            style={{ display:"flex", alignItems:"center", gap:7, padding:isMobile?"10px 14px":"8px 14px", fontSize:13, border:"1px solid #E2EDE9", borderRadius:9, background:"#fff", color:"#6B8F80", cursor:"pointer" }}
            onMouseEnter={e => { e.currentTarget.style.background="#FFF0EE"; e.currentTarget.style.color="#C0392B"; e.currentTarget.style.borderColor="#F5C6C0"; }}
            onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.color="#6B8F80"; e.currentTarget.style.borderColor="#E2EDE9"; }}
          >
            Limpiar
          </button>
          {!isMobile && <div style={{ flex:1 }} />}
          <button onClick={exportExcel}
            style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:isMobile?"11px 20px":"9px 22px", fontSize:13, fontWeight:600, border:"none", borderRadius:9, background:"#0F6E56", color:"#fff", cursor:"pointer", flex:isMobile?"1 0 100%":"none" }}
            onMouseEnter={e => e.currentTarget.style.background="#085041"}
            onMouseLeave={e => e.currentTarget.style.background="#0F6E56"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Descargar .xlsx
          </button>
        </div>

        {/* ── Separador: sección nueva ── */}
        <div style={{ display:"flex", alignItems:"center", gap:12, margin:"32px 0 16px" }}>
          <div style={{ flex:1, height:1, background:"#E2EDE9" }} />
          <span style={{ fontSize:10, fontWeight:600, color:"#9CB8AE", textTransform:"uppercase", letterSpacing:"0.08em", whiteSpace:"nowrap" }}>
            Excel desde PDF
          </span>
          <div style={{ flex:1, height:1, background:"#E2EDE9" }} />
        </div>

        {/* ── Componente PDF → Excel ── */}
        <PdfToExcel meta={meta} showToast={showToast} />

        <div style={{ marginTop:32, textAlign:"center", fontSize:11, color:"#9CB8AE" }}>
          Logistics and Services · Portal de despachos · El archivo se genera localmente en tu equipo
        </div>
        <div style={{ marginTop:6, textAlign:"center", fontSize:11, color:"#0F6E56", fontWeight:600 }}>
          Made by Logistics and Services © 2026
        </div>
      </div>

      {/* Toast */}
      <div style={{
        position:"fixed", bottom:20, left:"50%",
        transform:`translateX(-50%) translateY(${toast.visible?0:10}px)`,
        zIndex:1000, background:"#1a2e27", color:"#fff",
        padding:"10px 20px", borderRadius:24, fontSize:13, fontWeight:500,
        opacity:toast.visible?1:0, transition:"all 0.25s ease",
        pointerEvents:"none", whiteSpace:"nowrap",
        boxShadow:"0 4px 20px rgba(0,0,0,0.2)",
        maxWidth:"90vw", textAlign:"center",
      }}>
        {toast.message}
      </div>

      <SuccessPopup visible={popup} meta={meta} onClose={() => setPopup(false)} onNewRequest={newRequest} />
    </div>
  );
}